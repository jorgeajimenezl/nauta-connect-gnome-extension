# Nauta Connect

Utility to authenticate in ETECSA network

## Dependencies
+ [gxml](https://gitlab.gnome.org/GNOME/gxml/)
+ [libsecret](https://gitlab.gnome.org/GNOME/libsecret/)
+ [libsoup](https://gitlab.gnome.org/GNOME/libsoup)

## Install from AUR (Archlinux)
Go to [gnome-extension-shell-nauta-connect-git](https://aur.archlinux.org/packages/gnome-extension-shell-nauta-connect-git). You can use a tool like `yay` to install it:
```bash
$ yay gnome-extension-shell-nauta-connect-git
```

## Install from Gnome Extensions
First check if you have installed all the dependencies. Then open [Gnome Extensions](https://extensions.gnome.org) and search `Nauta Connect` in the search bar.

## Install from source
### Install
```bash
$ git clone https://github.com/jorgeajimenezl/nauta-connect-gnome-extension
$ cd nauta-connect-gnome-extension
$ chmod +x install.sh
$ ./install.sh
```

### Enable/Disable
```bash
gnome-extensions [enable|disable] nauta-connect@jorgeajimenezl.com
```

## Author
> Jorge Alejandro Jiménez Luna <jorgeajimenezl17@gmail.com>