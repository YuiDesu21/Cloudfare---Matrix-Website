-- Update user-facing exit terminology without changing internal action_type values.
update public.matrix_exit_rules
set
  action_label = case exit_number
    when 1 then 'Re-Stake F3-900'
    when 2 then 'Buy 1K'
    when 3 then 'Re-Stake 1K'
    when 4 then 'Buy 1.5K'
    when 5 then 'Re-Stake 1.5K F3'
    when 6 then 'Buy 3K'
    when 7 then 'Re-Stake 3K'
    when 8 then 'Buy 5K'
    when 9 then 'Re-Stake 5K F3'
    when 10 then 'Buy 10K'
    when 11 then 'Re-Stake 10K F3'
    when 12 then 'Buy 20K'
    when 13 then 'Re-Stake 20K F3'
    else action_label
  end,
  requirement_rank = case exit_number
    when 1 then '3 direct downlines approved'
    when 2 then '3 direct downlines completed Exit 1 / re-staked 900'
    when 3 then '3 direct downlines completed Exit 2 / bought 1K'
    when 4 then '3 direct downlines completed Exit 3 / re-staked 1K'
    when 5 then '3 direct downlines completed Exit 4 / bought 1.5K'
    when 6 then '3 direct downlines completed Exit 5 / re-staked 1.5K F3'
    when 7 then '3 direct downlines completed Exit 6 / bought 3K'
    when 8 then '3 direct downlines completed Exit 7 / re-staked 3K'
    when 9 then '3 direct downlines completed Exit 8 / bought 5K'
    when 10 then '3 direct downlines completed Exit 9 / re-staked 5K F3'
    when 11 then '3 direct downlines completed Exit 10 / bought 10K'
    when 12 then '3 direct downlines completed Exit 11 / re-staked 10K F3'
    when 13 then '3 direct downlines completed Exit 12 / bought 20K'
    else requirement_rank
  end;
