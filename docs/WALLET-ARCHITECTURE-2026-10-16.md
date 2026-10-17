# Wallet architecture handoff

The member wallet screens use the existing Supabase `member_fund_ledger`. Its
`(member_id, account)` pair identifies Main and Investment Funds; amounts are
stored as `numeric(12,2)`, not floating-point columns. Pending Main withdrawals,
pending Budget investment requests, and active investment principal are excluded
from transferable balance by the existing backend helpers. Investment withdrawal
is not exposed: the withdrawal RPC debits Main Funds only.

The new `202610160001_wallet_transfer_idempotency.sql` migration adds
`transfer_wallet_funds`. One client-generated UUID identifies both immutable
ledger entries. Under the existing member advisory lock, the function validates
ownership, exact-decimal amount, available balance, and repeat use of the UUID.
The response includes updated available balances and the reference. It also
adds richer, member-scoped activity, withdrawal, and investment-request details
to `get_my_member_funds_dashboard`. The prior wallet-transfer RPC grants are
removed so authenticated clients cannot bypass retry protection.

## Rollout

1. **Done on October 16:** applied the new migration to staging project
   `sssfvmyukpmzbktdlybg` only. No live migration was applied.
2. **Done:** ran `scripts/staging-wallet-transfer-smoke.sql` and the existing
   `staging-funds-smoke.sql` against staging in rollback-only transactions.
3. Still perform signed-in Main to Investment and Investment to Main transfers with
   disposable staged balances, including retry of the same reference and two
   concurrent requests against the same source balance.
4. Reconcile ledger totals and recent activity before any live rollout. Take a
   fresh backup and obtain the project's normal approval for financial changes.

In environments where the migration is not applied, the new transfer modal
reports that the backend update is needed; it does not fall back to an unkeyed transfer.
Deposit and withdrawal continue to use the existing admin-verified workflows.
The local preview points at staging; no actual member transfer or payment was
submitted during this implementation.

## Existing rule to review

`member_investment_available` currently releases principal automatically once
`budget_investment_contracts.unlocks_at` has passed. No separate admin settlement
event is required. Monthly investment income is ledgered with a future
`available_at` and becomes available at its due time. Those established rules
were not changed here. If the business intends explicit approval before capital
release, that requires a separate backend policy decision and migration.

## Current limits

- History filters and search cover the latest 200 member ledger entries plus
  request records returned by the dashboard RPC. Server-side pagination and
  export are not implemented.
- Investment purchases and reinvestments still use the Budget Plan's existing
  eligible-rank request and admin-approval flow. The wallet links to that flow;
  no new investment products or returns were introduced.
- Transfer timeout handling checks the ledger for the reference and retries only
  with that same UUID. It does not claim success until the backend confirms it.

## Main Funds modal refinement

The existing Main Funds balance card and wallet tabs remain in place. Deposit,
withdrawal, and Matrix earnings forms now open from that page as entry, review,
and outcome modals. The old withdrawal URL redirects to the withdrawal modal;
the separate withdrawal history and admin approval workflow remain intact.

The `202610160002_funds_action_idempotency.sql` migration was applied to the
linked staging project only. It wraps existing withdrawal and Matrix-income
functions with one member-owned request UUID, replay checks, and a status lookup
for uncertain network outcomes. The established backend continues to enforce
the PHP 500 Main withdrawal minimum, available-balance reservation, due-earnings
eligibility, Premium transfer minimum, and member advisory lock. A pending
withdrawal also blocks Matrix-income transfer under the existing rule. Deposit
requests still use `request_member_fund_topup`; the unique payment reference and
admin approval prevent immediate or duplicate credit.

Matrix-income transfers were already recorded in `member_fund_ledger` as
`matrix_income_transfer`, and the dashboard already retrieved them. The Main
Funds history now labels those credits by plan and exposes a dedicated Matrix
Earnings filter, including prior recorded entries. It does not fabricate a
historical backfill. The dashboard's latest-200-ledger-entry limit still applies.

`scripts/staging-funds-actions-smoke.sql` passed against staging inside a
rollback-only transaction. It verified withdrawal replay and reservation,
changed-payload rejection, a due Budget income transfer and replay, exactly one
Main Funds ledger credit, status lookup, and insufficient-earnings rejection.
The browser check covered the old-route redirect, modal opening, deposit review,
and 390px layout. No real member deposit, withdrawal, or earnings transfer was
submitted. Before live rollout, apply the migration under the project's normal
approval process and run signed-in end-to-end approval, concurrency, and balance
reconciliation checks using disposable accounts.
