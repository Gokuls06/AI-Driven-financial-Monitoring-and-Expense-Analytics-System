import re, io, os, json, pickle
import numpy  as np
import pandas as pd
from datetime import datetime, timedelta
from collections import defaultdict

from sklearn.pipeline                import Pipeline
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model            import LogisticRegression
from sklearn.preprocessing           import LabelEncoder
from sklearn.ensemble                import IsolationForest

MODEL_DIR  = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(MODEL_DIR, "category_model.pkl")
ENC_PATH   = os.path.join(MODEL_DIR, "label_encoder.pkl")

# ── CATEGORY CONFIG ───────────────────────────────────────────────────────────
CAT_COLORS = {
    "Food":          "#f59e0b",
    "Shopping":      "#a855f7",
    "Entertainment": "#ef4444",
    "Utilities":     "#3b82f6",
    "Health":        "#10b981",
    "Transport":     "#06b6d4",
    "Investment":    "#00e676",
    "Transfer":      "#f472b6",
    "Education":     "#8b5cf6",
    "Income":        "#22c55e",
    "Others":        "#6b7280",
}

CAT_ICONS = {
    "Food": "🍽️", "Shopping": "🛍️", "Entertainment": "🎬",
    "Utilities": "⚡", "Health": "💊", "Transport": "🚗",
    "Investment": "📈", "Transfer": "↔️", "Education": "🎓",
    "Income": "💰", "Others": "💳",
}

KEYWORDS = {
    "Food":          ["swiggy","zomato","SWIGGY","ZOMATO", "mcdonald","kfc","pizza","restaurant","cafe","biryani",
                      "burger","hotel","bakery","sweets","food","meal","snack","dharbar",
                      "kannur cocktail","bawa hotel","fast food","sri amman","snacks"],
    "Shopping":      ["amazon","flipkart","myntra","ajio","nykaa","mall","store","meesho",
                      "dmart","decathlon","retail","RETAIL","mart","vaishali metal","mangal",
                      "auto","AUTO","clothing","silks","shop","la scentse","sarees","pothys","vivo","realme","boat","redmi"],
    "Entertainment": ["netflix","prime","hotstar","spotify","pvr","inox","bookmyshow",
                      "disney","youtube","tata play","tataplay","google play","gaming"],
    "Utilities":     ["electricity","water","gas","broadband","wifi","internet","bill",
                      "recharge","jio","airtel","bsnl","vodafone","postpaid","prepaid",
                      "tneb","apy","apyscf","pension","lombard","insurance","icici lom"],
    "Health":        ["gym","pharmacy","hospital","doctor","lab","clinic","medic",
                      "apollo","cult fit","1mg","diagnostic","wellness","health","medicals"],
    "Transport":     ["ola","uber","petrol","diesel","metro","bus","irctc","flight",
                      "rapido","cab","taxi","toll","fastag","fuel","rapido","bunk","redbus","redtaxi","taxi"],
    "Investment":    ["zerodha","groww","angel one","angelone","upstox","mutual fund",
                      "sip","nps","demat","brokerage","iccl","brk","paying angel",
                      "angel one limited"],
    "Transfer":      ["transfer","neft","imps","rtgs","self","emi","saravanan",
                      "credit card bill","card bill","loan","chandrasekaran","kaasu",
                      "senthilkumar","senthil kumar","Abdul","priyadharshini","srinivasan",
                      "anbarasu","vijayanirmala"],
    "Education":     ["college","school","university","institute","coaching","tuition",
                      "fee","vmkv","engineering college","course","admission"],
    "Income":        ["salary","dividend","interest","credited","refund","cashback",
                      "bonus","received","payment from","deposit","vijayanirmala",
                      "priyadharshini","srinivasan","anbarasu","bna seq","atm"],
}

# TRAINING DATA --------------------------------------------------
def _gen_training():
    X, y = [], []
    for cat, kws in KEYWORDS.items():
        if cat == "Others": continue
        for kw in kws:
            for tmpl in [kw, f"{kw} payment", f"paid {kw}", f"{kw} india", f"{kw} pvt ltd", f"{kw} bill"]:
                X.append(tmpl); y.append(cat)
    return X, y

# TRAIN-----------------------------------------------------
def train(extra_X=None, extra_y=None):
    X, y = _gen_training()
    if extra_X: X += extra_X; y += extra_y
    le    = LabelEncoder()
    y_enc = le.fit_transform(y)
    pipe  = Pipeline([
        ("tfidf", TfidfVectorizer(analyzer="char_wb", ngram_range=(2,4),
                                  max_features=8000, sublinear_tf=True)),
        ("clf",   LogisticRegression(max_iter=1000, C=5.0, solver="lbfgs")),
    ])
    pipe.fit(X, y_enc)
    with open(MODEL_PATH, "wb") as f: pickle.dump(pipe, f)
    with open(ENC_PATH,   "wb") as f: pickle.dump(le,   f)
    return {"status": "trained", "classes": list(le.classes_), "n_samples": len(X)}

def _load_model():
    if not os.path.exists(MODEL_PATH): train()
    with open(MODEL_PATH, "rb") as f: pipe = pickle.load(f)
    with open(ENC_PATH,   "rb") as f: le   = pickle.load(f)
    return pipe, le

# ── PARSE REAL INDIAN BANK CSV ────────────────────────────────────────────────
def _clean_inr(s):
    if not s: return None
    s = str(s).strip()
    if s in ["-", " - ", "", "None", "nan"]: return None
    s = re.sub(r"[^\d.]", "", s)
    return float(s) if s else None

def _clean_desc(raw):
    s = str(raw or "").strip()
    if not s or s.startswith("/") or s.lower().startswith("ci /"):
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
    parts = [p.strip() for p in s.split("/")]
    clean = []
    for p in parts[1:]:
        if not p: continue
        if p.upper() in _SKIP: continue
        if p.upper().startswith("XXXXX"): continue
        if "@" in p: continue
        if re.match(r"^\d{4,}$", p): continue             # pure numeric ref
        if "BRANCH" in p.upper(): continue
        if len(p) <= 2: continue                           # 1-2 char noise
        # Skip trailing bank-name tokens
        if re.match(r"^(Punjab|Canara|Axis|HDFC|ICICI|SBI|State|Indian|Yes|Kotak|Federal|Airtel|Paytm)",
                    p, re.I): continue
        clean.append(p)
    name = clean[0] if clean else s[:80]
    return re.sub(r"\s+", " ", name).strip()[:80]

def _parse_date(s):
    s = str(s or "").strip()
    for fmt in ["%d %b %Y", "%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d-%b-%Y"]:
        try: return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except: pass
    return None

def parse_bank_csv(content: str) -> list:
    """Parse Indian Bank multi-header CSV statement."""
    rows = []
    lines = content.splitlines()
    balance = 0.0
    for line in lines:
        cols = [c.strip().strip('"') for c in line.split(",")]
        if len(cols) < 14: continue
        # Col indices: 1=date, 2=desc, 8=debit, 10=credit, 13=balance
        date_raw  = cols[1]
        desc_raw  = cols[2]
        debit_raw = cols[8]  if len(cols) > 8  else ""
        cred_raw  = cols[10] if len(cols) > 10 else ""
        bal_raw   = cols[13] if len(cols) > 13 else ""

        date = _parse_date(date_raw)
        if not date: continue
        desc = _clean_desc(desc_raw)
        if not desc: continue

        debit  = _clean_inr(debit_raw)
        credit = _clean_inr(cred_raw)
        if debit is None and credit is None: continue

        amount  = credit if credit else -(debit or 0)
        bal_val = _clean_inr(bal_raw)
        if bal_val: balance = bal_val
        else: balance += amount

        rows.append({
            "date":        date,
            "description": desc,
            "amount":      round(amount, 2),
            "balance":     round(balance, 2),
            "mode":        _detect_mode(desc_raw),
            "raw_desc":    desc_raw,
        })
    return sorted(rows, key=lambda r: r["date"])

def parse_csv_simple(content: str) -> list:
    """Parse simple date,description,amount CSV."""
    rows = []
    balance = 0.0
    for i, line in enumerate(content.splitlines()):
        line = line.strip()
        if not line: continue
        if i == 0 and re.search(r"date|description|amount", line, re.I): continue
        parts = [p.strip().strip('"') for p in line.split(",")]
        if len(parts) < 3: continue
        date = _parse_date(parts[0])
        if not date: continue
        desc   = parts[1]
        amt_s  = re.sub(r"[^\d.\-]", "", parts[-1])
        amount = float(amt_s) if amt_s else None
        if amount is None: continue
        balance += amount
        rows.append({"date": date, "description": desc, "amount": round(amount, 2),
                     "balance": round(balance, 2), "mode": _detect_mode(desc), "raw_desc": desc})
    return sorted(rows, key=lambda r: r["date"])

def _detect_mode(desc):
    d = str(desc or "").upper()
    # Ignore bank branch metadata such as "/BRANCH : ATM SERVICE BRANCH";
    # it does not describe the original transaction channel.
    parts = [p.strip() for p in d.split("/")]
    d = " / ".join(p for p in parts if p and not re.match(r"^BRANCH\s*:", p))
    if re.search(r"(^|[/\s])UPI([/\s]|$)", d) or "@" in d: return "UPI"
    if "NEFT" in d or "IMPS" in d or "RTGS" in d:           return "Net Banking"
    if any(x in d for x in ("CARD", "POS", "ECOM", "MERCHNT", "TERMINAL ID")):
        return "Card"
    if any(x in d for x in ("BNA", "ATM ID", "ATM WDL", "ATM CASH", "CASH WITHDRAWAL")):
        return "ATM"
    return "Bank"

# ── PREDICT (FULL ML PIPELINE) ────────────────────────────────────────────────
def predict(transactions: list) -> dict:
    if not transactions:
        return {"error": "No transactions"}

    pipe, le = _load_model()
    df = pd.DataFrame(transactions)
    df["amount"] = pd.to_numeric(df["amount"], errors="coerce").fillna(0)
    df["date"]   = pd.to_datetime(df["date"])

    # ── Categorise ────────────────────────────────────────────────────────────
    descs = df["description"].fillna("").str.lower().tolist()
    probs = pipe.predict_proba(descs)
    cats  = le.inverse_transform(probs.argmax(axis=1))
    confs = (probs.max(axis=1) * 100).round(1)
    df["category"]   = cats
    df["confidence"] = confs
    df["color"]      = df["category"].map(lambda c: CAT_COLORS.get(c, "#6b7280"))
    df["icon"]       = df["category"].map(lambda c: CAT_ICONS.get(c, "💳"))

    # ── Core stats ────────────────────────────────────────────────────────────
    credits = df[df["amount"] > 0]
    debits  = df[df["amount"] < 0]
    income  = float(credits["amount"].sum())
    spent   = float(debits["amount"].abs().sum())
    net     = round(income - spent, 2)
    rate    = round((net / income * 100), 1) if income > 0 else 0.0

    # ── Category summary ──────────────────────────────────────────────────────
    summary = {}
    for cat, grp in debits.groupby("category"):
        summary[cat] = {
            "total":  round(float(grp["amount"].abs().sum()), 2),
            "count":  int(len(grp)),
            "avg":    round(float(grp["amount"].abs().mean()), 2),
            "color":  CAT_COLORS.get(cat, "#6b7280"),
            "icon":   CAT_ICONS.get(cat, "💳"),
        }

    # ── Payment mode breakdown ─────────────────────────────────────────────────
    mode_counts = df["mode"].value_counts().to_dict()

    # ── Anomaly detection ─────────────────────────────────────────────────────
    anomalies = []
    if len(debits) >= 5:
        amounts = debits["amount"].abs().values.reshape(-1, 1)
        iso     = IsolationForest(contamination=0.10, random_state=42)
        flags   = iso.fit_predict(amounts)
        anom_df = debits[flags == -1].copy()
        anom_df["date"] = anom_df["date"].dt.strftime("%Y-%m-%d")
        anomalies = anom_df[["date","description","amount","category","confidence"]].to_dict("records")

    # ── Next-month forecast per category ──────────────────────────────────────
    debits["month"] = debits["date"].dt.to_period("M")
    monthly = debits.groupby(["month","category"])["amount"].sum().abs().reset_index()
    monthly["month_num"] = monthly["month"].apply(lambda p: p.ordinal)
    forecast = {}
    for cat, grp in monthly.groupby("category"):
        vals = grp["amount"].values.astype(float)
        if len(vals) >= 2:
            x = grp["month_num"].values.astype(float)
            coeffs = np.polyfit(x, vals, 1)
            pred = float(np.polyval(coeffs, x[-1] + 1))
            forecast[cat] = max(0, round(pred, 2))
        else:
            forecast[cat] = round(float(vals.mean()), 2)

    bills = _detect_bills(debits)

    # ── Investment signals ─────────────────────────────────────────────────────
    investments = _get_investment_signals(debits)

    # ── Goal projections (from savings rate) ──────────────────────────────────
    goal_projection = _goal_projections(income, spent, net)

    # ── AI insights ───────────────────────────────────────────────────────────
    insights = _generate_insights(income, spent, net, rate, summary, anomalies, forecast)

    # ── Daily cashflow for chart ───────────────────────────────────────────────
    df["day"] = df["date"].dt.strftime("%Y-%m-%d")
    daily_in  = df[df["amount"] > 0].groupby("day")["amount"].sum().to_dict()
    daily_out = df[df["amount"] < 0].groupby("day")["amount"].sum().abs().to_dict()
    all_days  = sorted(set(list(daily_in.keys()) + list(daily_out.keys())))
    cashflow  = [{"date": d, "income": round(daily_in.get(d, 0), 2),
                  "spent": round(daily_out.get(d, 0), 2)} for d in all_days]

    df["date"] = df["date"].dt.strftime("%Y-%m-%d")

    return {
        "transactions":     df[["date","description","amount","balance","mode","category",
                                 "confidence","color","icon"]].to_dict("records"),
        "summary":          summary,
        "income":           round(income, 2),
        "spent":            round(spent, 2),
        "net":              net,
        "savings_rate":     rate,
        "mode_breakdown":   mode_counts,
        "anomalies":        anomalies,
        "forecast":         forecast,
        "bills":            bills,
        "investments":      investments,
        "goal_projection":  goal_projection,
        "insights":         insights,
        "cashflow":         cashflow,
        "total_txns":       len(df),
        "account": {
            "holder":   "Gokulnath Senthilkumar",
            "bank":     "Indian Bank",
            "account":  "7740248337",
            "ifsc":     "IDIB000S269",
            "branch":   "Salem Junction",
            "period":   "01 Feb 2026 – 28 Feb 2026",
            "opening":  960.32,
            "closing":  6441.50,
        }
    }

def _detect_bills(debits_df):
    bills = []
    bill_kws = {
        "JIO Postpaid":    ("Utilities", 470.82),
        "Airtel":          ("Utilities", 299.00),
        "Tata Play":       ("Entertainment", 149.00),
        "APY Pension":     ("Utilities", 46.00),
        "ICICI Lombard":   ("Health", 1499.00),
        "Angel One":       ("Investment", 1000.00),
    }
    for name, (cat, amt) in bill_kws.items():
        key = name.lower().split()[0]
        match = debits_df[debits_df["description"].str.lower().str.contains(key, na=False)]
        if not match.empty:
            bills.append({
                "name":    name,
                "category": cat,
                "amount":  round(float(match["amount"].abs().mean()), 2),
                "due":     "Next billing cycle",
                "urgent":  amt > 400,
            })
    return bills

def _get_investment_signals(debits_df):
    inv_txns = debits_df[debits_df["category"] == "Investment"].copy()
    result = []
    for _, row in inv_txns.iterrows():
        d = str(row["description"]).lower()
        inv_type = "Stock" if any(k in d for k in ["angel","zerodha","groww","stock"]) \
               else "SIP"   if "sip" in d \
               else "Mutual Fund"
        result.append({
            "name":     row["description"],
            "type":     inv_type,
            "amount":   round(abs(float(row["amount"])), 2),
            "date":     row["date"].strftime("%Y-%m-%d") if hasattr(row["date"], "strftime") else str(row["date"]),
        })
    # Static portfolio enrichment
    portfolio = [
        {"name": "Nifty 50 Index Fund", "type": "Mutual Fund",
         "invested": 14586, "current": 18420, "gain": 26.3},
        {"name": "Angel One Portfolio",  "type": "Stock",
         "invested": 49000, "current": 52400, "gain": 7.0},
        {"name": "Tech Growth SIP",      "type": "SIP",
         "invested": 4860,  "current": 5240,  "gain": 7.8},
    ]
    total_inv = sum(p["invested"] for p in portfolio)
    total_cur = sum(p["current"]  for p in portfolio)
    return {
        "detected_txns": result,
        "portfolio":     portfolio,
        "total_invested": total_inv,
        "total_current":  total_cur,
        "overall_gain":   round((total_cur - total_inv) / total_inv * 100, 1),
        "monthly_sip":    sum(r["amount"] for r in result if r["type"] == "SIP"),
    }

def _goal_projections(income, spent, net, goals=None):
    if goals is None:
        goals = [
            {"name": "Emergency Fund",       "target": 100000, "saved": 22000, "deadline": "Jun 2026"},
            {"name": "Europe Vacation 2027", "target": 120000, "saved": 35000, "deadline": "Dec 2027"},
            {"name": "New Laptop",           "target": 80000,  "saved": 48000, "deadline": "Aug 2026"},
        ]
    monthly_save = max(net, 0)
    projections = []
    for g in goals:
        remaining = g["target"] - g["saved"]
        months_needed = round(remaining / monthly_save, 1) if monthly_save > 0 else 999
        pct   = min(100, round(g["saved"] / g["target"] * 100, 1))
        on_track = months_needed <= 12
        projections.append({
            **g,
            "percent":       pct,
            "remaining":     remaining,
            "months_needed": months_needed,
            "on_track":      on_track,
            "monthly_save":  round(monthly_save, 2),
            "insight":       f"At ₹{monthly_save:,.0f}/month savings, goal reached in ~{months_needed:.0f} months." if monthly_save > 0 else "Increase income or cut spending to save towards this goal.",
        })
    return {"goals": projections, "monthly_savings": round(monthly_save, 2), "savings_rate": round((net/income*100) if income else 0, 1)}

def _generate_insights(income, spent, net, rate, summary, anomalies, forecast):
    insights = []
    if income > 0:
        insights.append(f"You earned ₹{income:,.0f} and spent ₹{spent:,.0f} this period — savings rate: {rate}%.")
    cats_sorted = sorted(summary.items(), key=lambda x: x[1]["total"], reverse=True)
    if cats_sorted:
        top = cats_sorted[0]
        pct = round(top[1]["total"] / spent * 100) if spent else 0
        insights.append(f"{top[0]} is your top expense at {pct}% of spending (₹{top[1]['total']:,.0f}).")
        save20 = top[1]["total"] * 0.2
        insights.append(f"Cutting {top[0].lower()} by 20% saves ₹{save20:,.0f}/month = ₹{save20*12:,.0f}/year.")
    if len(cats_sorted) >= 2:
        t2 = cats_sorted[0][1]["total"] + cats_sorted[1][1]["total"]
        p2 = round(t2 / spent * 100) if spent else 0
        insights.append(f"Top 2 categories ({cats_sorted[0][0]} + {cats_sorted[1][0]}) = {p2}% of all spending.")
    if anomalies:
        insights.append(f"⚠ {len(anomalies)} unusual transaction(s) flagged — check the anomalies section.")
    if forecast:
        total_fc = sum(forecast.values())
        insights.append(f"Next month forecast: ₹{total_fc:,.0f} projected spending based on your trend.")
    return insights

# ── CLI TEST ──────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("Training model...")
    print(train())
    print("\nModel ready. Import ml_engine and call parse_bank_csv() + predict()")