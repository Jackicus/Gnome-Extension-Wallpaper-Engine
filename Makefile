DEV := ./scripts/dev.sh
NESTED := ./scripts/nested.sh

.PHONY: all link install reload prefs logs uninstall status clean help \
        nested nested-headless nested-stop nested-status preview

all: install

link install reload prefs logs uninstall status:
	@$(DEV) $@

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
	@$(NESTED) help
