
import re, io, csv
from datetime import datetime

# ── Date helpers ──────────────────────────────────────────────────────────────
DATE_FORMATS = [
    "%d %b %Y", "%d-%b-%Y", "%d/%b/%Y",          # 15 Jan 2025
    "%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y",           # ISO / Indian
    "%m/%d/%Y", "%m-%d-%Y",                        # US style
    "%d %b %y", "%d-%b-%y",                        # 15 Jan 25
    "%d/%m/%y", "%d-%m-%y",                        # 15/01/25
    "%Y%m%d",                                      # 20250115
]

def _parse_date(raw) -> str | None:
    s = re.sub(r"\s+", " ", str(raw or "").strip())
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return None

def _clean_amount(raw) -> float | None:
    """Strip currency symbols, commas, parens (negative) → float.
    Also handles PNB-style suffixes: '20915.54 Cr.' / '1118.11 Dr.'
    The Cr./Dr. suffix on a balance column indicates credit/debit balance,
    NOT the sign of the transaction — so we return the raw positive value
    and let the caller decide sign from the Dr/Cr amount columns.
    """
    s = str(raw or "").strip()
    if not s or s in {"-", "--", "N/A", "nan", "None"}:
        return None
    negative = s.startswith("(") and s.endswith(")")
    # PNB / some banks append " Cr." or " Dr." to balances — strip it
    s = re.sub(r"\s*(cr\.?|dr\.?)$", "", s, flags=re.IGNORECASE).strip()
    s = re.sub(r"[^\d.]", "", s)
    if not s:
        return None
    val = float(s)
    return -val if negative else val

def _detect_mode(desc: str) -> str:
    d = desc.upper()
    for mode, keys in {
        "UPI":  ["UPI", "PHONEPE", "GPAY", "PAYTM", "BHIM"],
        "NEFT": ["NEFT"],
        "IMPS": ["IMPS"],
        "RTGS": ["RTGS"],
        "ATM":  ["ATM", "CASH", "BNA"],
        "Card": ["POS", "CARD", "SWIPE"],
        "EMI":  ["EMI", "NACH", "ECS", "SI "],
    }.items():
        if any(k in d for k in keys):
            return mode
    return "UPI"

def _clean_desc(raw: str) -> str:
    s = str(raw or "").strip()
    if not s or re.fullmatch(r"[-/\s]+", s):
        return ""
    # Named transaction patterns → fixed labels
    if re.search(r"BNA\s*SEQ|TRAN\s*DATE", s, re.I):   return "ATM Cash Deposit"
    if re.search(r"APYSCF|APY[-\s]NPST", s, re.I):     return "APY Pension Fund"
    if re.search(r"ATM_AMC|BULK CHARGES", s, re.I):    return "Bank Charges"
    if re.search(r"SMS_CHGS|SMS CHRG", s, re.I):       return "SMS Charges"
    if re.search(r"CREDIT INTEREST|Int\.Pd", s, re.I): return "Credit Interest"
    if re.search(r"MIN BAL CHGS", s, re.I):            return "Min Balance Charges"
    if re.search(r"LOAN RECOVERY|Loan Recovery", s):   return "Loan Repayment"
    # Tokens to always discard regardless of position
    _SKIP = {
        "UPI","NEFT","IMPS","RTGS","ATM","DR","CR","IN","OUT",
        "MOB","SELFFT",                                    # Axis mobile/self-transfer
        "P2A","P2M","P2C","P2P","P2V","P2U",              # UPI transfer-type codes
        "UPI CO","COLLEC","PAYMEN","REMARK",               # Axis truncated labels
        "PHONE","UTIB","SBIN","HDFC","ICICI",              # bank short codes
    }
    parts = [p.strip() for p in re.split(r"[/|]", s)]
    useful = []
    for p in parts:
        if not p: continue
        if p.upper() in _SKIP: continue
        if re.match(r"^XXXXX|^\d{4,}$", p): continue
        if "@" in p or "BRANCH" in p.upper(): continue
        if len(p) <= 2: continue
        # Skip trailing bank-name tokens
        if re.match(r"^(Punjab|Canara|Axis|HDFC|ICICI|SBI|State|Indian|Yes|Kotak|Federal|Airtel|Paytm)",
                    p, re.I): continue
        useful.append(p)
    result = useful[0] if useful else s[:80]
    return re.sub(r"\s+", " ", result).strip()[:80]


def _score_header(cell: str, role: str) -> int:
    """Score how well a cell matches a semantic role. Exact > substring (min 4 chars)."""
    c = cell.lower().strip()
    HINTS = {
        "date":   ["txn date","transaction date","value date","tran date","date"],
        "desc":   ["description","narration","particulars","transaction details","remarks"],
        "debit":  ["dr amount","debit amount","withdrawal amount","debit","withdrawal"],
        "credit": ["cr amount","credit amount","deposit amount","credit","deposit"],
        "balance":["closing balance","running balance","balance","bal"],
    }
    for hint in HINTS.get(role, []):
        if hint == c:
            return 100                          # exact match — highest priority
        if hint in c and len(hint) >= 4:        # substring only for 4+ char hints
            return len(hint)
    return 0


def _clean_inr(raw) -> float | None:
    """Clean Indian bank amount strings like '20915.54 Cr.' '1,200.00' '(500.00)'"""
    s = str(raw or "").strip()
    if not s or s in {"-", "--", "N/A", "nan", "None",
                      "Debits", "Credits", "Balance", "Dr Amount", "Cr Amount"}:
        return None
    s = re.sub(r"[A-Za-z\s]", "", s)       # strip letters (Cr. Dr.)
    s = re.sub(r"[^\d.]", "", s)            # keep digits and dot only
    if not s:
        return None
    parts = s.split(".")
    if len(parts) > 2:
        s = parts[0] + "." + parts[1]      # keep only first decimal
    try:
        return float(s)
    except ValueError:
        return None


def _parse_xlsx(raw_bytes: bytes) -> list[dict]:
    """Parse any bank .xlsx using openpyxl with smart header detection."""
    try:
        import openpyxl
    except ImportError:
        raise ImportError("pip install openpyxl")

    import io as _io
    wb = openpyxl.load_workbook(_io.BytesIO(raw_bytes), data_only=True)
    ws = wb.active
    all_rows = [
        [str(c).strip() if c is not None else "" for c in row]
        for row in ws.iter_rows(values_only=True)
    ]

    # Find header row
    col_map, header_idx = {}, 0
    for i, row in enumerate(all_rows[:25]):
        matched = {}
        for role in ["date", "desc", "debit", "credit", "balance"]:
            best_idx, best_score = -1, 0
            for j, cell in enumerate(row):
                s = _score_header(cell, role)
                if s > best_score:
                    best_score, best_idx = s, j
            if best_idx >= 0 and best_score > 0:
                matched[role] = best_idx
        if "date" in matched and "desc" in matched and \
                ("debit" in matched or "credit" in matched):
            # Prevent debit/credit from aliasing to the desc column
            if matched.get("debit") == matched.get("desc"):
                matched.pop("debit", None)
            if matched.get("credit") == matched.get("desc"):
                matched.pop("credit", None)
            if "debit" in matched or "credit" in matched:
                col_map = matched
                header_idx = i
                break

    if not col_map:
        return []

    g = lambda role, row: (
        row[col_map[role]] if role in col_map and col_map[role] < len(row) else ""
    )
    txns, balance = [], 0.0
    for row in all_rows[header_idx + 1:]:
        if not any(row):
            continue
        date = _parse_date(g("date", row))
        if not date:
            continue
        desc_raw = g("desc", row)
        desc = _clean_desc(desc_raw)
        if not desc:
            continue
        debit  = _clean_inr(g("debit",  row))
        credit = _clean_inr(g("credit", row))
        if debit is None and credit is None:
            continue
        amount = (credit or 0.0) - (debit or 0.0)
        bal = _clean_inr(g("balance", row))
        balance = bal if bal is not None else balance + amount
        txns.append({
            "date":        date,
            "description": desc,
            "amount":      round(amount, 2),
            "balance":     round(balance, 2),
            "mode":        _detect_mode(desc_raw),
            "raw_desc":    desc_raw,
        })
    return sorted(txns, key=lambda t: t["date"])
# Maps semantic role → possible column header substrings (lowercase)
HEADER_HINTS = {
    "date":    ["date", "txn date", "transaction date", "value date", "posting date", "tran date"],
    "desc":    ["description", "narration", "particulars", "remarks", "details", "transaction details"],
    "debit":   ["debit", "withdrawal", "dr", "withdraw", "debit amount"],
    "credit":  ["credit", "deposit", "cr", "deposit amount", "credit amount"],
    "amount":  ["amount", "net amount", "transaction amount"],
    "balance": ["balance", "closing balance", "running balance", "avl balance", "available balance"],
    "mode":    ["mode", "type", "channel", "payment mode"],
}

def _score_header(cell: str, role: str) -> int:
    c = cell.lower().strip()
    for hint in HEADER_HINTS[role]:
        if hint in c:
            return len(hint)          # longer match = higher confidence
    return 0

def _find_columns(headers: list[str]) -> dict:
    """Return best column index for each semantic role."""
    mapping = {}
    for role in HEADER_HINTS:
        best_idx, best_score = -1, 0
        for i, h in enumerate(headers):
            s = _score_header(h, role)
            if s > best_score:
                best_score, best_idx = s, i
        if best_idx >= 0:
            mapping[role] = best_idx
    return mapping


# ── CSV reader helpers ────────────────────────────────────────────────────────
def _read_csv_rows(text: str) -> list[list[str]]:
    """Return all non-empty rows from CSV text."""
    reader = csv.reader(io.StringIO(text))
    return [[c.strip().strip('"\'') for c in row] for row in reader if any(c.strip() for c in row)]

def _find_header_row(rows: list[list[str]]) -> int:
    """Return index of the row most likely to be the column header."""
    best_idx, best_score = 0, 0
    for i, row in enumerate(rows[:20]):          # search first 20 rows only
        score = sum(
            1 for cell in row
            if any(
                hint in cell.lower()
                for hints in HEADER_HINTS.values()
                for hint in hints
            )
        )
        if score > best_score:
            best_score, best_idx = score, i
    return best_idx


# ── Core parsing logic ────────────────────────────────────────────────────────
def _row_to_txn(row: list[str], col: dict, running_balance: float) -> dict | None:
    """Convert a raw CSV row to a transaction dict using detected column mapping."""
    get = lambda role: row[col[role]].strip() if role in col and col[role] < len(row) else ""

    date = _parse_date(get("date"))
    if not date:
        return None

    desc_raw = get("desc")
    desc = _clean_desc(desc_raw)
    if not desc:
        return None

    # Determine amount ---------------------------------------------------------
    debit  = _clean_amount(get("debit"))
    credit = _clean_amount(get("credit"))
    net_am = _clean_amount(get("amount"))

    if debit is not None or credit is not None:
        # Separate debit / credit columns
        amount = (credit or 0.0) - (debit or 0.0)
    elif net_am is not None:
        # Single signed amount column
        # Try to infer sign from mode/type column
        mode_raw = get("mode").upper()
        if any(k in mode_raw for k in ["DR", "DEBIT", "WITHDRAWAL"]):
            amount = -abs(net_am)
        elif any(k in mode_raw for k in ["CR", "CREDIT", "DEPOSIT"]):
            amount = abs(net_am)
        else:
            amount = net_am          # trust raw sign
    else:
        return None

    # Balance ------------------------------------------------------------------
    bal_raw = get("balance")
    bal = _clean_amount(bal_raw)
    if bal is not None:
        running_balance = bal
    else:
        running_balance += amount

    return {
        "date":        date,
        "description": desc,
        "amount":      round(amount, 2),
        "balance":     round(running_balance, 2),
        "mode":        _detect_mode(desc_raw or desc),
        "raw_desc":    desc_raw,
        "_balance_ref": running_balance,   # carry forward
    }


# ── PDF-extracted text fallback ───────────────────────────────────────────────
# Many bank PDFs become space-separated text after pdfplumber/pdfminer extraction.
# We try to parse lines that match a date-amount pattern.
_DATE_RE  = re.compile(r"\b(\d{1,2}[-/ ][A-Za-z]{3}[-/ ]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{2}/\d{2}/\d{4})\b")
_MONEY_RE = re.compile(r"[\d,]+\.\d{2}")

def _parse_freetext(text: str) -> list[dict]:
    """Last-resort parser for unstructured (PDF-extracted) bank statement text."""
    txns, balance = [], 0.0
    for line in text.splitlines():
        dm = _DATE_RE.search(line)
        if not dm:
            continue
        amounts = _MONEY_RE.findall(line)
        if not amounts:
            continue
        date = _parse_date(dm.group(0))
        if not date:
            continue
        # Remove date and money tokens; remainder is description
        desc_raw = _DATE_RE.sub("", line)
        desc_raw = _MONEY_RE.sub("", desc_raw)
        desc_raw = re.sub(r"\s+", " ", desc_raw).strip()
        desc = _clean_desc(desc_raw) or desc_raw[:80]
        if not desc:
            continue

        floats = [_clean_amount(a) for a in amounts]
        floats = [f for f in floats if f is not None]

        if len(floats) >= 3:
            # Pattern: [debit_or_0]  [credit_or_0]  [balance]
            balance = floats[-1]
            amount  = floats[-2] - floats[-3] if floats[-3] else floats[-2]
            amount  = floats[-2] if floats[-2] else -floats[-3]
        elif len(floats) == 2:
            balance, amount = floats[-1], floats[-2] if floats[-2] > 0 else -floats[-1]
            balance = floats[-1]
            amount  = floats[0]
        else:
            amount  = floats[0]
            balance += amount

        txns.append({
            "date":        date,
            "description": desc,
            "amount":      round(amount, 2),
            "balance":     round(balance, 2),
            "mode":        _detect_mode(desc_raw),
            "raw_desc":    desc_raw,
        })
    return txns


# ── Public API ────────────────────────────────────────────────────────────────
def parse_statement(source) -> list[dict]:
    """
    Universal entry point.
    Args:
        source: bytes or str — raw bytes or text of any bank statement
                (CSV, TXT, or XLSX).
    Returns:
        List of transaction dicts sorted by date, compatible with ml_engine.predict().
    """
    raw_bytes = source if isinstance(source, (bytes, bytearray)) else None

    # ── Detect XLSX by magic bytes (PK zip header) → route to xlsx parser ─────
    if raw_bytes and raw_bytes[:4] == b"PK\x03\x04":
        txns = _parse_xlsx(raw_bytes)
        if txns:
            return txns

    # Decode bytes to text for CSV / TXT parsing
    if raw_bytes is not None:
        for enc in ("utf-8", "latin-1", "cp1252"):
            try:
                text = raw_bytes.decode(enc)
                break
            except UnicodeDecodeError:
                pass
        else:
            text = raw_bytes.decode("utf-8", errors="replace")
    else:
        text = str(source)

    # ── Attempt structured CSV parse ──────────────────────────────────────────
    try:
        rows = _read_csv_rows(text)
    except Exception:
        rows = []
    if len(rows) >= 3:
        header_idx = _find_header_row(rows)
        headers    = rows[header_idx]
        col        = _find_columns(headers)

        # We need at least date + desc + (debit|credit|amount)
        has_amount = "debit" in col or "credit" in col or "amount" in col
        if "date" in col and "desc" in col and has_amount:
            txns, balance = [], 0.0
            for row in rows[header_idx + 1:]:
                if not any(row):
                    continue
                txn = _row_to_txn(row, col, balance)
                if txn:
                    balance = txn.pop("_balance_ref")
                    txns.append(txn)
            if txns:
                return sorted(txns, key=lambda t: t["date"])

    # ── Fallback: fixed-column heuristic (Indian Bank legacy format) ──────────
    # Handles the original 14-column format used in the existing project
    fixed = _parse_fixed_column(text)
    if fixed:
        return fixed

    # ── Last resort: free-text / PDF-extracted ────────────────────────────────
    return sorted(_parse_freetext(text), key=lambda t: t["date"])


def _parse_fixed_column(text: str) -> list[dict]:
    """
    Handles Indian Bank's specific multi-header CSV where columns are at
    fixed indices: 1=date, 2=desc, 8=debit, 10=credit, 13=balance.
    Falls back gracefully if the layout doesn't match.
    """
    txns, balance = [], 0.0
    matched = 0
    for line in text.splitlines():
        cols = [c.strip().strip('"') for c in line.split(",")]
        if len(cols) < 9:
            continue
        date = _parse_date(cols[1])
        if not date:
            continue
        desc = _clean_desc(cols[2])
        if not desc:
            continue
        debit  = _clean_amount(cols[8]  if len(cols) > 8  else "")
        credit = _clean_amount(cols[10] if len(cols) > 10 else "")
        if debit is None and credit is None:
            continue
        amount  = (credit or 0.0) - (debit or 0.0)
        bal_val = _clean_amount(cols[13] if len(cols) > 13 else "")
        balance = bal_val if bal_val is not None else balance + amount
        txns.append({
            "date":        date,
            "description": desc,
            "amount":      round(amount, 2),
            "balance":     round(balance, 2),
            "mode":        _detect_mode(cols[2]),
            "raw_desc":    cols[2],
        })
        matched += 1
    # Only trust this parser if it found a reasonable number of rows
    return sorted(txns, key=lambda t: t["date"]) if matched >= 2 else []


# ── Compatibility shims for ml_engine.py ─────────────────────────────────────
def parse_bank_csv(content: str) -> list:
    """Drop-in for the original ml_engine.parse_bank_csv."""
    return parse_statement(content)

def parse_csv_simple(content: str) -> list:
    """Drop-in for the original ml_engine.parse_csv_simple."""
    return parse_statement(content)


# ── Quick self-test ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    sample_hdfc = """Date,Narration,Value Dat,Debit Amount,Credit Amount,Chq/Ref No,Closing Balance
01/04/2025,UPI/SWIGGY FOOD/9999,01/04/2025,450.00,,REF001,24550.00
02/04/2025,SALARY CREDIT APRIL,02/04/2025,,50000.00,REF002,74550.00
03/04/2025,ATM CASH WDL,03/04/2025,5000.00,,,69550.00
"""
    result = parse_statement(sample_hdfc)
    for t in result:
        print(t)
    print(f"\n✅ Parsed {len(result)} transactions from sample HDFC CSV")