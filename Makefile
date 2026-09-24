DEV := ./scripts/dev.sh
NESTED := ./scripts/nested.sh

.PHONY: all link install reload prefs logs uninstall status clean help \
        check bench nested nested-headless nested-stop nested-status preview zip

all: install

link install reload prefs logs uninstall status:
	@$(DEV) $@

# The extensions.gnome.org upload, in dist/.
zip:
	@$(DEV) pack

# Every pattern's shader, compiled (check) or timed on the GPU (bench), outside the shell.
check bench:
	@node scripts/shaders.mjs $@

clean:
	rm -f src/schemas/gschemas.compiled
	rm -rf dist

# Nested shell -- a throwaway second GNOME Shell for visual testing.
nested:
	@$(NESTED) start

nested-headless:
	@$(NESTED) start --headless

nested-stop:
	@$(NESTED) stop

nested-status:
	@$(NESTED) status

preview:
	@$(NESTED) start >/dev/null && $(NESTED) shot

help:
	@$(DEV) help
	@echo
	@sed -n '4,7p' scripts/shaders.mjs | sed 's|^// ||'
	@echo
	@$(NESTED) help
