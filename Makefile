UUID = weatheroclock@CleoMenezesJr.github.io
DOMAIN = weather-oclock
PO_DIR = po
EXT_DIR = weatheroclock@CleoMenezesJr.github.io
LOCALE_DIR = $(EXT_DIR)/locale

ifeq ($(strip $(DESTDIR)),)
	INSTALLTYPE = local
	INSTALLBASE = $(HOME)/.local/share/gnome-shell/extensions
else
	INSTALLTYPE = system
	SHARE_PREFIX = $(DESTDIR)/usr/share
	INSTALLBASE = $(SHARE_PREFIX)/gnome-shell/extensions
endif
INSTALLNAME = weatheroclock@CleoMenezesJr.github.io

PO_FILES = $(wildcard $(PO_DIR)/*.po)
MO_FILES = $(patsubst $(PO_DIR)/%.po, $(LOCALE_DIR)/%/LC_MESSAGES/$(DOMAIN).mo, $(PO_FILES))

.PHONY: default
default: build

.PHONY: build
build: compile-locales
	glib-compile-schemas ./$(EXT_DIR)/schemas[cite: 10]

.PHONY: compile-locales
compile-locales: $(MO_FILES)

$(LOCALE_DIR)/%/LC_MESSAGES/$(DOMAIN).mo: $(PO_DIR)/%.po
	@echo "Kompilowanie tłumaczenia dla języka: $*..."
	mkdir -p $(dir $@)
	msgfmt $< -o $@[cite: 8]

.PHONY: install
install: build
	rm -rf $(INSTALLBASE)/$(INSTALLNAME)[cite: 10]
	mkdir -p $(INSTALLBASE)/$(INSTALLNAME)[cite: 10]
	cp -r ./$(EXT_DIR)/* $(INSTALLBASE)/$(INSTALLNAME)[cite: 10]
	rm -f ./$(EXT_DIR)/schemas/gschemas.compiled[cite: 10]

.PHONY: uninstall
uninstall:
	rm -rf $(INSTALLBASE)/$(INSTALLNAME)[cite: 10]

.PHONY: clean
clean:
	rm -f ./$(EXT_DIR)/schemas/gschemas.compiled[cite: 10]
	rm -rf $(LOCALE_DIR)[cite: 8]
