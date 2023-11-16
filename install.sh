blueprint-compiler batch-compile src/ui src/ui src/ui/*.blp
mkdir -p ~/.local/share/gnome-shell/extensions/nauta-connect@jorgeajimenezl.com
cp -r src/* ~/.local/share/gnome-shell/extensions/nauta-connect@jorgeajimenezl.com
glib-compile-schemas ~/.local/share/gnome-shell/extensions/nauta-connect@jorgeajimenezl.com/schemas/