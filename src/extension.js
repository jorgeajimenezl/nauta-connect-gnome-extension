const GETTEXT_DOMAIN = 'nauta-connect';

const {
    GObject,
    St,
    Secret,
    Clutter,
    GLib,
    Gio,
} = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Mainloop = imports.mainloop;

const _ = ExtensionUtils.gettext;
const NautaSession = Me.imports.nautaSession.NautaSession;

function format_number(x, length) {
    let res = `${x}`;
    let len = r.length();
    while (--length > len)
        res = '0' + res;
    return res;
}

const Indicator = GObject.registerClass(
    class Indicator extends PanelMenu.Button {
        _init() {
            super._init(0.0, _('Nauta Connect'));
            
            this.settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.nauta-connect');
            this.session = new NautaSession(this.settings);

            this._refresh_timer_id = null;
            this.start_time = 0;
            this.total_time = null;

            this._connect_settings();
            this._create_ui();
            this._populate_users();

            if (this.session.connected)
                this._setup_time_updater();
        }

        _destroy_timer() {
            if (this._refresh_timer_id != null) {
                Mainloop.source_remove(this._refresh_timer_id);
                this._refresh_timer_id = null;
            }
        }

        destroy() {
            this._destroy_timer();
            super.destroy();
        }

        _connect_settings() {
            this.time_info = this.settings.get_string('time-info');
            log(`choosen: ${this.time_info}`);
            
            // this.settings.bind('changed::time-info', () => {
            //     this.timeInfo = this.settings.get_string('time-info');
            // });
        }

        _create_ui() {
            this._menu_layout = new St.BoxLayout({
                vertical: false,
                clip_to_allocation: true,
                x_align: Clutter.ActorAlign.START,
                y_align: Clutter.ActorAlign.CENTER,
                reactive: true,
                x_expand: true,
                pack_start: false
            });

            this._menu_layout.add_actor(new St.Icon({
                gicon: Gio.icon_new_for_string(Me.path + '/icons/etecsa-logo.svg'),
                style_class: 'system-status-icon',
            }));

            this.timer_label = new St.Label({
                text: 'Still unavailable :)',
                visible: this.session.connected,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._menu_layout.add_actor(this.timer_label);            

            this.connect_menu = new PopupMenu.PopupSubMenuMenuItem(_("Connect"), true);
            this.connect_menu.icon.icon_name = 'avatar-default-symbolic';
            this.connect_menu.visible = !this.session.connected;
            this.menu.addMenuItem(this.connect_menu);

            this.disconnect_button = new PopupMenu.PopupMenuItem(_("Disconnect"));
            this.disconnect_button.visible = this.session.connected;
            this.disconnect_button.connect('activate', () => {
                this.menu._getTopMenu().close();
                this.session.logout_async(null, (_, r) => {
                    if (r.had_error() || !this.session.logout_finish(r)) {
                        Main.notify('Unable to logout from actual session');
                        return;
                    }

                    this.connect_menu.visible = true;
                    this.disconnect_button.visible = false;
                    this.timer_label.visible = false;                    
                    this.total_time = null;
                    this._destroy_timer();
                    log('disconnected successful');
                });
            });
            this.disconnect_button.insert_child_at_index(new St.Icon({
                style_class: 'popup-menu-icon',
                icon_name: 'network-wired-disconnected-symbolic'
            }), 1);
            this.menu.addMenuItem(this.disconnect_button);

            let reset_state = new PopupMenu.PopupMenuItem(_("Reset state"));
            reset_state.connect('activate', () => {
                this.menu._getTopMenu().close();
                this.session.connected = false;             
            });
            reset_state.insert_child_at_index(new St.Icon({
                style_class: 'popup-menu-icon',
                icon_name: 'view-refresh-symbolic'
            }), 1);
            this.menu.addMenuItem(reset_state);

            let prefs_button = new PopupMenu.PopupMenuItem(_("Settings"));
            prefs_button.connect('activate', () => {
                this.menu._getTopMenu().close();
                ExtensionUtils.openPrefs();
            });
            prefs_button.insert_child_at_index(new St.Icon({
                style_class: 'popup-menu-icon',
                icon_name: 'preferences-system-symbolic'
            }), 1);

            this.menu.addMenuItem(prefs_button);
            this.add_actor(this._menu_layout);
        }

        _update_timer() {
            let seconds = (GLib.get_monotonic_time() - this.start_time) / 1000 / 1000;
            if (this.time_info == 'remain' && this.total_time == null) {
                this.timer_label.text = 'No Available :(';
            } else {
                if (this.time_info == 'remain')
                    seconds = this.total_time - seconds;
                this.timer_label.text = `${format_number((seconds / 60 / 60) | 0, 2)}:${format_number(((seconds / 60) % 60) | 0, 2)}:${format_number((seconds % 60) | 0, 2)}`;
            }
        }

        _setup_time_updater() {
            this.start_time = GLib.get_monotonic_time(); // microseconds                          

            // get remained time
            this.session.get_remaining_time_async(null, (_, r) => {
                try {
                    this.total_time = this.session.get_remaining_time_finish(r);
                } catch (e) {
                    this.total_time = null;
                }
                this.timer_label.visible = true;
            });

            if (this.time_info != 'none') {
                // timer update
                this._refresh_timer_id = Mainloop.timeout_add_seconds(1.0, (self) => {
                    this._update_timer();
                    return true;
                });
            }
        }

        _populate_users() {
            const schema = Secret.Schema.new('org.jorgeajimenezl.nauta-connect.SearchNetworkCredentials',
                Secret.SchemaFlags.DONT_MATCH_NAME, {
                "application": Secret.SchemaAttributeType.STRING,
            });

            Secret.password_search(schema, {
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
                            this.connect_menu.visible = false;
                            this.disconnect_button.visible = true;
                            this._setup_time_updater();
                        });
                    });
                    this.connect_menu.menu.addMenuItem(item);
                }                    
            });
        }
    });

class Extension {
    constructor(uuid) {
        this._uuid = uuid;
        ExtensionUtils.initTranslations(GETTEXT_DOMAIN);
    }

    enable() {
        this._indicator = new Indicator();
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