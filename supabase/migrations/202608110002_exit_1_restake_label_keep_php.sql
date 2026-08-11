-- Exit 1 wording is 20 F3 Token, but the action amount remains PHP 900.

update public.matrix_exit_rules
set action_label = 'Re-Stake 20 F3 Token',
    action_amount = 900
where exit_number = 1;
