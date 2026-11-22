</main>
<p class="toast" role="status" aria-live="polite" data-toast hidden></p>
<script src="<?= asset('js/admin.js') ?>" defer></script>
<?php if (!empty($extra_scripts)) foreach ($extra_scripts as $src): ?>
<script src="<?= asset($src) ?>" defer></script>
<?php endforeach; ?>
</body>
</html>
