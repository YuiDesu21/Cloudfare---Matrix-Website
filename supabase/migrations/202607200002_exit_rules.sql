insert into public.matrix_exit_rules
  (exit_number, requirement_rank, required_downline_exit, action_type, action_label, action_amount, passive_income, passive_months, product_spend, product_bonus_percent, product_months)
values
  (1, '3 direct downlines approved', 0, 'reinvest', 'Reinvest F3-900', 900, 297, 3, 0, 0, 0),
  (2, '3 direct downlines completed Exit 1 / reinvested 900', 1, 'invest', 'Invest 1K', 1000, 330, 3, 680, 15, 3),
  (3, '3 direct downlines completed Exit 2 / invested 1K', 2, 'reinvest', 'Reinvest 1K', 1000, 330, 3, 1080, 20, 3),
  (4, '3 direct downlines completed Exit 3 / reinvested 1K', 3, 'invest', 'Invest 1.5K', 1500, 490, 3, 1188, 25, 3),
  (5, '3 direct downlines completed Exit 4 / invested 1.5K', 4, 'reinvest', 'Reinvest 1.5K F3', 1500, 495, 3, 1417, 30, 3),
  (6, '3 direct downlines completed Exit 5 / reinvested 1.5K F3', 5, 'invest', 'Invest 3K', 3000, 990, 3, 2603, 35, 3),
  (7, '3 direct downlines completed Exit 6 / invested 3K', 6, 'reinvest', 'Reinvest 3K', 3000, 1003, 3, 2603, 40, 3),
  (8, '3 direct downlines completed Exit 7 / reinvested 3K', 7, 'invest', 'Invest 5K', 5000, 1650, 3, 4374, 45, 3),
  (9, '3 direct downlines completed Exit 8 / invested 5K', 8, 'reinvest', 'Reinvest 5K F3', 5000, 1650, 3, 5832, 50, 3),
  (10, '3 direct downlines completed Exit 9 / reinvested 5K F3', 9, 'invest', 'Invest 10K', 10000, 4620, 3, 6298, 55, 3),
  (11, '3 direct downlines completed Exit 10 / invested 10K', 10, 'reinvest', 'Reinvest 10K F3', 10000, 5049, 3, 6641, 60, 3),
  (12, '3 direct downlines completed Exit 11 / reinvested 10K F3', 11, 'invest', 'Invest 20K', 20000, 11550, 3, 8435, 65, 3),
  (13, '3 direct downlines completed Exit 12 / invested 20K', 12, 'reinvest', 'Reinvest 20K F3', 20000, 11880, 3, 10900, 70, 3)
on conflict (exit_number) do update set
  requirement_rank = excluded.requirement_rank,
  required_downline_exit = excluded.required_downline_exit,
  action_type = excluded.action_type,
  action_label = excluded.action_label,
  action_amount = excluded.action_amount,
  passive_income = excluded.passive_income,
  passive_months = excluded.passive_months,
  product_spend = excluded.product_spend,
  product_bonus_percent = excluded.product_bonus_percent,
  product_months = excluded.product_months;
