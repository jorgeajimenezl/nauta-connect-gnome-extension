const GETTEXT_DOMAIN = 'nauta-connect';

const {
    GObject,
    St,
    Secret,
    Clutter,
    GLib,
} = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Mainloop = imports.mainloop;

const _ = ExtensionUtils.gettext;
const Keyring = Me.imports.keyring;
const NautaSession = Me.imports.nautaSession.NautaSession;

function formatNumber(x, length) {
    let l = Math.log10(x) | 0;
    let r = `${x}`;
    while (--length > l)
        r = '0' + r;
    return r;
}

const Indicator = GObject.registerClass(
    class Indicator extends PanelMenu.Button {
        _init(settings, session) {
            super._init(0.0, _('Nauta Connect'));

            this.settings = settings;
            this.session = session;
            this._refreshTimerId = null;
            this.startTime = 0;
            this.totalTime = null;

            this._connect_settings();
            this._create_ui();
            this._populate_users();
        }

        _destroyTimer() {
            if (this._refreshTimerId != null) {
                Mainloop.source_remove(this._refreshTimerId);
                this._refreshTimerId = null;
            }
        }

        destroy() {
            this._destroyTimer();
            super.destroy();
        }

        _connect_settings() {
            this.timeInfo = this.settings.get_string('time-info');
            log(`choosen: ${this.timeInfo}`);
            
            // this.settings.bind('changed::time-info', () => {
            //     this.timeInfo = this.settings.get_string('time-info');
            // });
        }

        _create_ui() {
            this._menuLayout = new St.BoxLayout({
                vertical: false,
                clip_to_allocation: true,
                x_align: Clutter.ActorAlign.START,
                y_align: Clutter.ActorAlign.CENTER,
                reactive: true,
                x_expand: true,
                pack_start: false
            });

            this._menuLayout.add_actor(new St.Icon({
                icon_name: 'face-smile-symbolic',
                style_class: 'system-status-icon',
            }));

            this.timerLabel = new St.Label({
                text: 'Still unavailable :)',
                visible: this.session.connected,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._menuLayout.add_actor(this.timerLabel);            

            this.connectMenu = new PopupMenu.PopupSubMenuMenuItem(_("Connect"), true);
            this.connectMenu.icon.icon_name = 'avatar-default-symbolic';
            this.connectMenu.visible = !this.session.connected;
            this.menu.addMenuItem(this.connectMenu);

            this.disconnectButton = new PopupMenu.PopupMenuItem(_("Disconnect"));
            this.disconnectButton.visible = this.session.connected;
            this.disconnectButton.connect('activate', () => {
                this.menu._getTopMenu().close();
                this.session.logout_async(null, (_, r) => {
                    if (r.had_error() || !this.session.logout_finish(r)) {
                        Main.notify('Unable to logout from actual session');
                        return;
                    }

                    this.connectMenu.visible = true;
                    this.disconnectButton.visible = false;
                    this.timerLabel.visible = false;                    
                    this.totalTime = null;
                    this._destroyTimer();
                    log('disconnected successful');
                });
            });
            this.disconnectButton.insert_child_at_index(new St.Icon({
                style_class: 'popup-menu-icon',
                icon_name: 'network-wired-disconnected-symbolic'
            }), 1);
            this.menu.addMenuItem(this.disconnectButton);

            let resetState = new PopupMenu.PopupMenuItem(_("Reset state"));
            resetState.connect('activate', () => {
                this.menu._getTopMenu().close();
                this.session.connected = false;                
            });
            resetState.insert_child_at_index(new St.Icon({
                style_class: 'popup-menu-icon',
                icon_name: 'view-refresh-symbolic'
            }), 1);
            this.menu.addMenuItem(resetState);

            let prefsButton = new PopupMenu.PopupMenuItem(_("Settings"));
            prefsButton.connect('activate', () => {
                this.menu._getTopMenu().close();
                ExtensionUtils.openPrefs();
            });
            prefsButton.insert_child_at_index(new St.Icon({
                style_class: 'popup-menu-icon',
                icon_name: 'preferences-system-symbolic'
            }), 1);

            this.menu.addMenuItem(prefsButton);
            this.add_actor(this._menuLayout);
        }

        _update_timer() {
            let seconds = (GLib.get_monotonic_time() - this.startTime) / 1000 / 1000;
            if (this.timeInfo == 'remain' && this.totalTime == null) {
                this.timerLabel.text = 'No Available :(';
            } else {
                if (this.timeInfo == 'remain')
                    seconds = this.totalTime - seconds;
                this.timerLabel.text = `${formatNumber((seconds / 60 / 60) | 0, 2)}:${formatNumber(((seconds / 60) % 60) | 0, 2)}:${formatNumber((seconds % 60) | 0, 2)}`;
            }
        }

        _populate_users() {
            Secret.password_search(Keyring.SEARCH_NETWORK_CREDENTIALS, {
                'application': 'org.jorgeajimenezl.nauta-connect'
            }, Secret.SearchFlags.ALL | Secret.SearchFlags.UNLOCK | Secret.SearchFlags.LOAD_SECRETS, null, (_, r) => {
                let x = Secret.password_search_finish(r);

                for (let i = 0; i < x.length; i++) {
                    let user = x[i].get_label();
                    let pass = x[i].retrieve_secret_sync(null).get_text();
                    // let uuid = x[i].get_attributes()['uuid'];

                    let item = new PopupMenu.PopupMenuItem(user);
                    item.connect('activate', () => {
                        // connect
                        this.session.login_async(user, pass, null, (_, r) => {
                            if (r.had_error() || !this.session.login_finish(r)) {
                                Main.notify('Unable to login right now');
                                return;
                            } 
                            this.connectMenu.visible = false;
                            this.disconnectButton.visible = true;
                            this.startTime = GLib.get_monotonic_time(); // microseconds                          
                            
                            // get remained time
                            this.session.get_remaining_time_async(null, (_, r) => {
                                try {
                                    this.totalTime = this.session.get_remaining_time_finish(r);
                                } catch (e) {
                                    this.totalTime = null;
                                }
                                this.timerLabel.visible = true;
                            });

                            if (this.timeInfo != 'none') {
                                // timer update
                                this._refreshTimerId = Mainloop.timeout_add_seconds(1.0, (self) => {
                                    this._update_timer();
                                    return true;
                                });
                            }
                        });
                    });
                    this.connectMenu.menu.addMenuItem(item);
                }                    
            });
        }
    });

class Extension {
    constructor(uuid) {
        this._uuid = uuid;
        this.settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.nauta-connect');
        this.session = new NautaSession(this.settings);

        ExtensionUtils.initTranslations(GETTEXT_DOMAIN);
    }

    enable() {
        this._indicator = new Indicator(this.settings, this.session);
        Main.panel.addToStatusArea(this._uuid, this._indicator);
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }
}

function init(meta) {
    return new Extension(meta.uuid);
}