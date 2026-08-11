-- Keep Exit 1 payment amount at PHP 900 while displaying the 20 F3 Token restake label.

update public.matrix_exit_rules
set action_label = 'Re-Stake 20 F3 Token',
    action_amount = 900
where exit_number = 1;
