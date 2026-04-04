UUID = weatheroclock@CleoMenezesJr.github.io
ifeq ($(strip $(DESTDIR)),)
	INSTALLTYPE = local
	INSTALLBASE = $(HOME)/.local/share/gnome-shell/extensions
else
	INSTALLTYPE = system
	SHARE_PREFIX = $(DESTDIR)/usr/share
	INSTALLBASE = $(SHARE_PREFIX)/gnome-shell/extensions
endif
INSTALLNAME = weatheroclock@CleoMenezesJr.github.io

.PHONY: default
default: build

.PHONY: build
build:
	glib-compile-schemas ./weatheroclock@CleoMenezesJr.github.io/schemas

.PHONY: install
install: build
	rm -rf $(INSTALLBASE)/$(INSTALLNAME)
	mkdir -p $(INSTALLBASE)/$(INSTALLNAME)
	cp -r ./weatheroclock@CleoMenezesJr.github.io/* $(INSTALLBASE)/$(INSTALLNAME)
	rm  ./weatheroclock@CleoMenezesJr.github.io/schemas/gschemas.compiled

.PHONY: uninstall
uninstall:
	rm -rf $(INSTALLBASE)/$(INSTALLNAME)

.PHONY: clean
clean:
	rm -f ./weatheroclock@CleoMenezesJr.github.io/schemas/gschemas.compiled
