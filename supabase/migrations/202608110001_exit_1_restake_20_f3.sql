-- Exit 1 requires a 20 F3 Token re-stake; leave every other exit unchanged.

update public.matrix_exit_rules
set action_label = 'Re-Stake 20 F3 Token',
    action_amount = 20
where exit_number = 1;
