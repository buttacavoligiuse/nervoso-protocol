#!/usr/bin/env python3
"""
Novita affiliate monetization gate.
No click/signup counts as monetization.

Snapshot format:
{
  "captured_at": "2026-09-09T00:00:00Z",
  "referrals": 0,
  "commission_pending_usd": 0.0,
  "commission_approved_usd": 0.0,
  "commission_paid_usd": 0.0,
  "self_referral": false,
  "evidence": "Tapfiliate/Novita affiliate dashboard"
}
"""
import argparse, json

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--path", required=True)
    ap.add_argument("--usd-eur", type=float, default=0.92)
    a=ap.parse_args()
    d=json.load(open(a.path))
    if isinstance(d,list): d=d[-1]
    req=["captured_at","referrals","commission_pending_usd","commission_approved_usd",
         "commission_paid_usd","self_referral"]
    miss=[k for k in req if k not in d]
    if miss:
        print("INVALID — missing:",", ".join(miss)); return 2
    if d["self_referral"]:
        print("INVALID — self-referral cannot prove monetization."); return 2

    pending=float(d["commission_pending_usd"])
    approved=float(d["commission_approved_usd"])
    paid=float(d["commission_paid_usd"])

    print("NOVITA MONETIZATION GATE")
    print("captured_at:",d["captured_at"])
    print("referrals:",int(d["referrals"]))
    print(f"pending:  ${pending:.6f}")
    print(f"approved: ${approved:.6f}")
    print(f"paid:     ${paid:.6f} (~€{paid*a.usd_eur:.6f})")

    if paid>0:
        print("\nVERDICT: CASH_PROVEN")
        print("Commissione realmente pagata > 0.")
        return 0
    if approved>0:
        print("\nVERDICT: MONETIZATION_PROVEN")
        print("Commissione approvata > 0; cash payout non ancora osservato.")
        return 0
    if pending>0:
        print("\nVERDICT: ATTRIBUTION_PROVEN")
        print("Commissione pending > 0; attendere approvazione/payout.")
        return 1

    print("\nVERDICT: UNPROVEN")
    print("Nessuna commissione osservata.")
    return 1

if __name__=="__main__":
    raise SystemExit(main())
