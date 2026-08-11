-- Exit 1 restakes 20 F3 Token, worth PHP 1,200.

update public.matrix_exit_rules
set action_label = 'Re-Stake 20 F3 Token',
    action_amount = 1200
where exit_number = 1;
