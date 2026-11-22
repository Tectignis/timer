<?php
// There is no public site: the screen has its own link (screen.php?key=…), everything else is the admin panel.
require __DIR__ . '/includes/functions.php';
redirect('admin/index.php');
