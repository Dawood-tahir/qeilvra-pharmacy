"""Independent exact-decimal oracle for the read-only hosted audit evidence.

Requires only Python's standard library. No database or network connection and
no transaction writes. Reads PostgreSQL's original NUMERIC JSON tokens.
"""
import json
from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP, getcontext
from pathlib import Path
from zoneinfo import ZoneInfo

getcontext().prec = 90
ZERO = Decimal(0)
PK = ZoneInfo("Asia/Karachi")
evidence = json.loads(Path(".private/financial-audit-evidence.json").read_text(encoding="utf-8"), parse_float=Decimal)
tables = {name: [json.loads(row, parse_float=Decimal) for row in rows] for name, rows in evidence["snapshot"]["tables"].items()}
index = {name: {row["id"]: row for row in rows if "id" in row} for name, rows in tables.items()}
checks, failures, warnings = [], [], []


def check(label, actual, expected=True):
    (checks if actual == expected else failures).append({"check": label, "actual": actual, "expected": expected})


def total(values):
    return sum(values, ZERO)


def money(value):
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def day(timestamp):
    return datetime.fromisoformat(timestamp).astimezone(PK).date().isoformat()


def group(name, key):
    result = defaultdict(list)
    for row in tables.get(name, []):
        result[row[key]].append(row)
    return result


items = group("sale_items", "sale_id")
costs = group("sale_item_costs", "sale_item_id")
returns = group("return_items", "return_id")
allocations = group("return_allocations", "return_item_id")
payments = group("payments", "sale_id")
purchase_items = group("purchase_items", "purchase_id")
movements = group("stock_movements", "batch_id")
approved = [r for r in tables["sale_returns"] if r["status"] == "approved"]
approved_items = defaultdict(list)
for refund in approved:
    for item in returns[refund["id"]]:
        approved_items[item["sale_item_id"]].append((refund, item))


def base(item, line):
    return item.get("approved_base_quantity") if item.get("approved_base_quantity") is not None else (item.get("approved_quantity") or ZERO) * (line.get("base_units_per_sale_unit") or 1)


def restored_cost(refund, legacy=False):
    amount = ZERO
    for ri in returns[refund["id"]]:
        line = index["sale_items"][ri["sale_item_id"]]
        if not ri["restockable"] and not (legacy and line["selling_unit"] is None):
            continue
        allocated = allocations[ri["id"]]
        if allocated:
            amount += total(a["base_quantity"] * a["unit_cost"] for a in allocated)
        else:
            historical = costs[line["id"]]
            qty = total(c["quantity"] for c in historical)
            if qty:
                amount += base(ri, line) * total(c["quantity"] * c["unit_cost"] for c in historical) / qty
            warnings.append("Estimated return cost without allocations: " + ri["id"])
    return amount


for sale in tables["sales"]:
    sid = sale["id"]
    check("sale header formula " + sale["invoice_number"], sale["net_total"], sale["subtotal"] - sale["discount"] + sale["extra_charge_amount"])
    check("sale gross lines " + sid, total(i["line_total"] for i in items[sid]), sale["subtotal"])
    if all(i["net_line_total"] is not None for i in items[sid]):
        check("sale discounted lines " + sid, total(i["net_line_total"] for i in items[sid]), sale["net_total"] - sale["extra_charge_amount"])
    check("sale payment coverage " + sid, total(p["amount"] for p in payments[sid] if p["kind"] == "sale"), sale["net_total"])
    check("refund payment coverage " + sid, total(p["amount"] for p in payments[sid] if p["kind"] == "refund"), total(r["refund_amount"] for r in approved if r["sale_id"] == sid))
    for line in items[sid]:
        bid = line["quantity"] * (line["base_units_per_sale_unit"] or 1)
        check("sale base conversion " + line["id"], line["base_quantity"] if line["base_quantity"] is not None else bid, bid)
        check("cost quantity coverage " + line["id"], total(c["quantity"] for c in costs[line["id"]]), bid)
        check("sale line multiplication " + line["id"], line["line_total"], money(line["quantity"] * line["unit_price"]))
        if not costs[line["id"]] or any(c["unit_cost"] == 0 for c in costs[line["id"]]):
            warnings.append("Missing or zero historical cost requires review: " + line["id"])
        cumulative = ZERO
        for refund, ri in sorted(approved_items[line["id"]], key=lambda x: (x[0]["reviewed_at"], x[0]["id"])):
            quantity = base(ri, line)
            check("return allocation quantity " + ri["id"], total(a["base_quantity"] for a in allocations[ri["id"]]), quantity)
            cumulative += quantity
        check("return not greater than sold " + line["id"], cumulative <= bid)
        for cost in costs[line["id"]]:
            returned = [a for rows in allocations.values() for a in rows if a["sale_item_cost_id"] == cost["id"]]
            check("no reused return cost allocation " + cost["id"], total(a["base_quantity"] for a in returned) <= cost["quantity"])
            check("return cost preserves historical cost " + cost["id"], all(a["unit_cost"] == cost["unit_cost"] for a in returned))

for refund in approved:
    expected = ZERO
    for ri in returns[refund["id"]]:
        line = index["sale_items"][ri["sale_item_id"]]
        prior = total(base(other, line) for earlier, other in approved_items[line["id"]] if (earlier["reviewed_at"], earlier["id"]) < (refund["reviewed_at"], refund["id"]))
        sold = line["quantity"] * (line["base_units_per_sale_unit"] or 1)
        net = line["net_line_total"]
        if net is None:
            s = index["sales"][line["sale_id"]]
            net = line["line_total"] * (s["net_total"] - s["extra_charge_amount"]) / s["subtotal"] if s["subtotal"] else ZERO
        expected += money((prior + base(ri, line)) * net / sold) - money(prior * net / sold)
    check("cumulative original-price refund " + refund["id"], refund["refund_amount"], expected)
    check("approved refund payment " + refund["id"], total(p["amount"] for p in tables["payments"] if p["return_id"] == refund["id"]), refund["refund_amount"])

for p in tables["purchases"]:
    check("purchase header " + p["purchase_number"], p["total"], p["subtotal"] - p["discount"])
    check("purchase line total " + p["id"], total(i["line_total"] for i in purchase_items[p["id"]]), p["subtotal"])
    for item in purchase_items[p["id"]]:
        check("purchase exact line arithmetic " + item["id"], item["line_total"], money(item["quantity"] * item["unit_cost"]))
        if item["received_quantity"] is not None:
            check("purchase base conversion " + item["id"], item["quantity"], item["received_quantity"] * item["base_units_per_received_unit"])
        batches = [b for b in tables["medicine_batches"] if b["purchase_item_id"] == item["id"]]
        if p["status"] == "posted":
            check("single received batch " + item["id"], len(batches), 1)
            for batch in batches:
                expected_cost = item["unit_cost"] * p["total"] / p["subtotal"] if p["subtotal"] else item["unit_cost"]
                check("batch historical purchase cost " + batch["id"], abs(batch["purchase_cost"] - expected_cost) < Decimal("0.000000000001"))

for batch in tables["medicine_batches"]:
    check("batch stock movement balance " + batch["id"], batch["quantity_on_hand"], total(m["quantity_delta"] for m in movements[batch["id"]]))
    check("nonnegative stock " + batch["id"], batch["quantity_on_hand"] >= 0)
for unique_field in ["invoice_number", "idempotency_key"]:
    check("no duplicate sales " + unique_field, len({s[unique_field] for s in tables["sales"]}), len(tables["sales"]))
for payment in tables["payments"]:
    if payment["method"] == "cash":
        check("cash change " + payment["id"], payment["change_amount"], payment["tendered_amount"] - payment["amount"])

scoped = evidence["scopedReports"][0]["scoped"]
period_results = []
for scope in scoped["periods"]:
    snapshot = scope["analytics"]
    first, last = snapshot["from"], snapshot["to"]
    selected = [s for s in tables["sales"] if first <= day(s["completed_at"]) <= last and s["status"] in ("completed", "partially_refunded", "refunded")]
    refunded = [r for r in approved if first <= day(r["reviewed_at"]) <= last]
    sold_cost = total(c["quantity"] * c["unit_cost"] for s in selected for i in items[s["id"]] for c in costs[i["id"]])
    raw_cogs = sold_cost - total(restored_cost(r) for r in refunded)
    discounts = total(s["discount"] for s in selected)
    refunds = total(r["refund_amount"] for r in refunded)
    gross = total(s["subtotal"] for s in selected)
    extra = total(s["extra_charge_amount"] for s in selected)
    revenue = gross - discounts - refunds + extra
    expenses = total(e["amount"] for e in tables["expenses"] if first <= e["expense_date"] <= last)
    written = total(d["cost_value"] for d in tables["stock_dispositions"] if d["kind"] == "discard" and first <= day(d["created_at"]) <= last)
    returned = total(d["cost_value"] for d in tables["stock_dispositions"] if d["kind"] == "supplier_return" and first <= day(d["created_at"]) <= last)
    recoveries = [d for d in tables["stock_dispositions"] if d["recovery_state"] == "confirmed" and first <= day(d["confirmed_at"]) <= last]
    recovered = total(d["recovery_amount"] for d in recoveries if d["recovery_method"] in ("refund", "credit"))
    replaced = total(d["recovery_amount"] for d in recoveries if d["recovery_method"] == "replacement")
    loss = money(written) + money(returned) - recovered - replaced
    expected = dict(sales_count=len(selected), gross_sales=gross, discounts=discounts, refunds=refunds, medicine_revenue=gross-discounts-refunds,
                    extra_charge_revenue=extra, revenue=revenue, cogs=money(raw_cogs), gross_profit=revenue-money(raw_cogs), expenses=expenses,
                    stock_written_off=money(written), supplier_returns_value=money(returned), supplier_recoveries=recovered,
                    supplier_replacements_value=replaced, net_inventory_loss=loss, net_operating_profit=revenue-money(raw_cogs)-expenses-loss)
    for key, value in expected.items():
        check(scope["label"] + " RPC " + key, snapshot["metrics"][key], value)
        check(scope["label"] + " daily reconciles " + key, total(d[key] for d in snapshot["daily"]), value)
    for key in ("revenue", "gross_profit"):
        check(scope["label"] + " chart reconciles " + key, total(d[key] for d in snapshot["trend"]), expected[key])
    check(scope["label"] + " expense categories", total(c["amount"] for c in snapshot["expense_categories"]), expenses)
    check(scope["label"] + " cashier revenue", total(c["revenue"] for c in snapshot["salespeople"]), revenue)
    check(scope["label"] + " cashier count", total(c["sales_count"] for c in snapshot["salespeople"]), len(selected))
    for medicine in snapshot["medicines"]:
        mid = medicine["medicine_id"]
        expected_quantity = total(i["quantity"] * (i["base_units_per_sale_unit"] or 1) for s in selected for i in items[s["id"]] if i["medicine_id"] == mid)
        expected_quantity -= total(base(ri, index["sale_items"][ri["sale_item_id"]]) for r in refunded for ri in returns[r["id"]] if index["sale_items"][ri["sale_item_id"]]["medicine_id"] == mid)
        check(scope["label"] + " medicine base units " + mid, medicine["quantity"], expected_quantity)
    cohort_refunds = [r for r in approved if r["sale_id"] in {s["id"] for s in selected}]
    cohort_revenue = total(s["net_total"] for s in selected) - total(r["refund_amount"] for r in cohort_refunds)
    cohort_profit = money(cohort_revenue-sold_cost+total(restored_cost(r, legacy=True) for r in cohort_refunds))
    check(scope["label"] + " legacy cohort revenue", scope["legacy"]["revenue"], cohort_revenue)
    check(scope["label"] + " legacy cohort profit", scope["legacy"]["gross_profit"], cohort_profit)
    check(scope["label"] + " legacy trend revenue", total(d["revenue"] for d in scope["trend"]), cohort_revenue)
    breakdown = scope["breakdowns"]
    check(scope["label"] + " legacy extra charges", breakdown["extra_charge_revenue"], extra)
    check(scope["label"] + " legacy refund total", breakdown["refund_total"], total(r["refund_amount"] for r in cohort_refunds))
    check(scope["label"] + " legacy refund count", breakdown["return_count"], len(cohort_refunds))
    check(scope["label"] + " invoice-date purchase breakdown", breakdown["purchase_total"], total(p["total"] for p in tables["purchases"] if p["status"] == "posted" and first <= p["invoice_date"] <= last))
    for row in breakdown["medicine_sales"]:
        matching = [i for s in selected for i in items[s["id"]] if (i["medicine_id"], i["medicine_name"]) == (row["medicine_id"], row["medicine_name"])]
        qty, net = ZERO, ZERO
        for line in matching:
            returned_units = total(base(ri, line) for refund, ri in approved_items[line["id"]])
            sold_units = line["quantity"] * (line["base_units_per_sale_unit"] or 1)
            s = index["sales"][line["sale_id"]]
            line_net = line["net_line_total"]
            if line_net is None:
                line_net = line["line_total"] * (s["net_total"] - s["extra_charge_amount"]) / s["subtotal"] if s["subtotal"] else ZERO
            qty += sold_units-returned_units
            net += line_net-money(returned_units*line_net/sold_units)
        check(scope["label"] + " legacy medicine quantity " + row["medicine_id"], row["quantity"], qty)
        check(scope["label"] + " legacy medicine revenue " + row["medicine_id"], row["revenue"], net)
    for cashier in breakdown["salesperson_performance"]:
        owned = [s for s in selected if s["created_by"] == cashier["id"]]
        owned_ids = {s["id"] for s in owned}
        check(scope["label"] + " legacy cashier count " + cashier["id"], cashier["sales_count"], len(owned))
        check(scope["label"] + " legacy cashier revenue " + cashier["id"], cashier["revenue"], total(s["net_total"] for s in owned)-total(r["refund_amount"] for r in approved if r["sale_id"] in owned_ids))
    # Legacy trend rounds each day separately. Preserve its historical contract.
    legacy_trend_difference = total(d["gross_profit"] for d in scope["trend"])-cohort_profit
    if legacy_trend_difference:
        warnings.append(f"Legacy cohort trend rounds per day; {scope['label']} difference {legacy_trend_difference}")
    receipts = [p for p in tables["purchases"] if p["status"] == "posted" and first <= day(p["posted_at"]) <= last]
    cash_card = {method: total(p["amount"] if p["kind"] == "sale" else -p["amount"] for p in tables["payments"] if p["method"] == method and first <= day(p["created_at"]) <= last) for method in ("cash", "card")}
    # Tender movement and revenue recognition dates are distinct; compare and
    # report rather than rewriting valid timestamps to manufacture agreement.
    if total(cash_card.values()) != revenue:
        warnings.append(f"Payment event dates differ from sale/refund dates for {scope['label']}")
    period_results.append(dict(label=scope["label"], from_date=first, to_date=last, **expected, purchases=total(p["total"] for p in receipts), purchase_count=len(receipts), **cash_card))

today = evidence["snapshot"]["today"]
active = [m for m in tables["medicines"] if m["is_active"]]
available_by_medicine = {m["id"]: total(b["quantity_on_hand"] for b in tables["medicine_batches"] if b["medicine_id"] == m["id"] and not b["is_quarantined"] and b["expiry_date"] >= today) for m in active}
for scope in scoped["periods"]:
    inventory = scope["analytics"]["inventory"]
    check(scope["label"] + " active medicine count", inventory["total_medicines"], len(active))
    check(scope["label"] + " low stock count", inventory["low_stock_items"], sum(0 < available_by_medicine[m["id"]] <= m["reorder_level"] for m in active))
    check(scope["label"] + " out of stock count", inventory["out_of_stock_items"], sum(available_by_medicine[m["id"]] <= 0 for m in active))
for med in scoped["inventory"]:
    available = total(b["quantity_on_hand"] for b in tables["medicine_batches"] if b["medicine_id"] == med["id"] and not b["is_quarantined"] and b["expiry_date"] >= today)
    check("inventory search available base units " + med["id"], med["available_quantity"], available)
for sid, summary in (scoped["suppliers"] or {}).items():
    receipts = [p for p in tables["purchases"] if p["supplier_id"] == sid and p["status"] == "posted"]
    check("supplier purchases not multiplied by lines " + sid, summary["total"], total(p["total"] for p in receipts))
    check("supplier deliveries " + sid, summary["deliveries"], len(receipts))

inventory_value = money(total(b["quantity_on_hand"] * b["purchase_cost"] for b in tables["medicine_batches"]))
if not tables["stock_dispositions"] and all(m["kind"] in ("purchase", "sale", "return_restock", "return_non_sellable") for m in tables["stock_movements"]):
    lifetime_cogs = total(c["quantity"] * c["unit_cost"] for c in tables["sale_item_costs"]) - total(restored_cost(r) for r in approved)
    posted_cost = total(p["total"] for p in tables["purchases"] if p["status"] == "posted")
    check("inventory plus recognized lifetime COGS conserves posted receipt cost", inventory_value + money(lifetime_cogs), posted_cost)

report = dict(captured_at=evidence["snapshot"]["captured_at"], passed=len(checks), failures=failures, warnings=sorted(set(warnings)),
              periods=period_results, stock_units=total(b["quantity_on_hand"] for b in tables["medicine_batches"]),
              inventory_value=inventory_value,
              archive_installed=evidence["metadata"]["archive"], ledger_installed=evidence["metadata"]["ledger"])
Path(".private/financial-audit-reconciliation.json").write_text(json.dumps(report, default=str, indent=2), encoding="utf-8")
print(json.dumps(report, default=str, indent=2))
raise SystemExit(bool(failures))
