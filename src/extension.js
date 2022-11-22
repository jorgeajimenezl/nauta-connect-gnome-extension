const GETTEXT_DOMAIN = 'nauta-connect';

const {
    GObject,
    St,
    Secret,
    Clutter,
    GLib,
    Gio,
    Atk,
} = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Mainloop = imports.mainloop;
const QuickSettings = imports.ui.quickSettings;
const QuickSettingsMenu = imports.ui.main.panel.statusArea.quickSettings;

const _ = ExtensionUtils.gettext;
const NautaSession = Me.imports.nautaSession.NautaSession;

class UserMenuITem {
    constructor(user, session, settings) {
        this.user = user;
        this.item = new PopupMenu.PopupMenuItem(user.username);
        this.session = session;
        this.settings = settings;
        
        this.settings.bind("session-connected", this.item, 'visible', Gio.SettingsBindFlags.GET | Gio.SettingsBindFlags.INVERT_BOOLEAN);

        this._connectionId = this.item.connect("activate", () => {
            this.settings.set_string("current-username", user.username);
        });
    }

    login() {
        // Login
        this.session.login_async(this.user.username, this.user.password, null, (_, r) => {
            if (r.had_error() || !this.session.login_finish(r)) {
                Main.notify("Unable to login right now");
                return;
            }
        });
    }

    destroy() {
        if (this._connectionId != null) {
            this.item.disconnect(this._connectionId);
            this._connectionId = null;
        }
        this.item.destroy();
        // super.destroy();
    }
}

const NautaMenuToggle = GObject.registerClass(
    class NautaMenuToggle extends QuickSettings.QuickMenuToggle {
        _init(uuid, settings, session) {
            this.uuid = uuid;
            this.settings = settings;
            this.session = session;

            this._changedUserConnectionId = null;
            this._clickedConnectionId = null;
            this.items = [];
            
            const icon = Gio.icon_new_for_string(Me.path + '/icons/etecsa-logo.svg');

            super._init({
                label: _("Nauta"),
                gicon: icon,
                toggleMode: true,
            });

            this.menu.setHeader(icon, _("Nauta Connect"), _("Authenticate in ETECSA network"));
            this.settings.bind("session-connected", this, 'checked', Gio.SettingsBindFlags.GET);

            // Populate the list of users            
            this.buildMenu();

            // Setup logout action
            this._clickedConnectionId = this.connect(
                "clicked", () => { 
                    const username = this.settings.get_string("current-username");
                    const connected = this.settings.get_boolean("session-connected");

                    if (!connected) {
                        this.checked = false;
                        // this.menu.open();

                        for (const item of this.items) {
                            if (item.user.username == username)
                                item.login();
                        }
                    } else {
                        // Logout                        
                        this.session.logout_async(null, (_, r) => {
                            if (r.had_error() || !this.session.logout_finish(r)) {
                                Main.notify(_("Unable to logout from actual session"));
                                return;
                            }
                            this.checked = false;
                        });
                    }
                },
            );           
            
            // Connect settings
            this._changedUserConnectionId = this.settings.connect(
                "changed::current-username", () => {
                    // Mark current user
                    const username = this.settings.get_string("current-username");

                    for (const userItem of this.items) {
                        userItem.item.setOrnament(
                            (username == userItem.user.username) ? PopupMenu.Ornament.DOT
                                : PopupMenu.Ornament.NONE);
                    }
                },
            );
        }

        destroy() {
            if (this._changedUserConnectionId != null) {
                this.settings.disconnect(this._changedUserConnectionId);
                this._changedUserConnectionId = null;
            }

            if (this._clickedConnectionId != null) {
                this.disconnect(this._clickedConnectionId);
                this._clickedConnectionId = null;
            }

            for (const item of this.items) {
                item.destroy();
            }

            // super.destroy();
        }

        buildMenu() {
            const schema = Secret.Schema.new("org.jorgeajimenezl.nauta-connect.SearchNetworkCredentials",
                Secret.SchemaFlags.DONT_MATCH_NAME, {
                "application": Secret.SchemaAttributeType.STRING,
            });

            const username = this.settings.get_string("current-username");
            Secret.password_search(schema, {
                "application": "org.jorgeajimenezl.nauta-connect"
            }, Secret.SearchFlags.ALL | Secret.SearchFlags.UNLOCK | Secret.SearchFlags.LOAD_SECRETS, null, (_, r) => {
                const x = Secret.password_search_finish(r);

                for (let i = 0; i < x.length; i++) {
                    const user = x[i].get_label();
                    const pass = x[i].retrieve_secret_sync(null).get_text();

                    const item = new UserMenuITem({
                        username: user,
                        password: pass
                    }, this.session, this.settings);

                    item.item.setOrnament(
                        (username == user) ? PopupMenu.Ornament.DOT
                            : PopupMenu.Ornament.NONE);
                    
                    this.items.push(item);
                    this.menu.addMenuItem(item.item);
                }      
                
                // Setup setting
                // FIX: Need to push this code here coz if
                // not, the order is random (async)
                this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                const settingsItem = this.menu.addAction("Settings", () => ExtensionUtils.openPrefs());
                settingsItem.visible = Main.sessionMode.allowSettings;
                this.menu._settingsActions[this.uuid] = settingsItem;
            });             
        }
    }
);

const NautaIndicator = GObject.registerClass(
    class NautaIndicator extends PanelMenu.Button { 
        _init(uuid) {
            super._init({
                reactive: true,
                can_focus: true,
                track_hover: true,
                accessible_role: Atk.Role.PUSH_BUTTON,
            });                
            this.add_style_class_name("nauta-indicator");

            this.settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.nauta-connect');
            this.session = new NautaSession(this.settings);
            this.quickSettingsItems = [];
            
            this._refreshTimerConnectionId = null;
            this._connectedConnectionId = null;
            this._startTime = 0;
            this._totalTime = null;
            this._notified = false;

            this.buildUI();           
                               
            this._connectedConnectionId = this.settings.connect(
                "changed::session-connected", () => {
                    const connected = this.settings.get_boolean("session-connected");

                    if (connected) {
                        this.show();
                        this.setupTimer();                        
                    } else {
                        this.hide();
                        this._totalTime = null;
                        this.destroyTimer();
                    }
                },
            );
            
            // Create the toggle menu and associate it with the indicator, being
            // sure to destroy it along with the indicator
            this.quickSettingsItems.push(new NautaMenuToggle(uuid, this.settings, this.session));
            
            // Add the indicator to the panel and the toggle to the menu
            // QuickSettingsMenu._indicators.insert_child_at_index(this, 0);
            Main.panel.addToStatusArea(uuid, this);
            QuickSettingsMenu._addItems(this.quickSettingsItems);
        }

        buildUI() {
            this._box = new St.BoxLayout();
            this.add_child(this._box);

            this._label = new St.Label({
                text: "",
                y_align: Clutter.ActorAlign.CENTER,
                visible: true,
            });
            
            this._box.add_child(this._label);

            this._icon = new St.Icon({ icon_name: 'window-close-symbolic' });
            this._box.add_child(this._icon);

            this.hide();
        }

        vfunc_event(event) {
            if (event.type() === Clutter.EventType.TOUCH_BEGIN ||
                event.type() === Clutter.EventType.BUTTON_PRESS) {
                    // Logout

                    this.session.logout_async(null, (_, r) => {
                        if (r.had_error() || !this.session.logout_finish(r)) {
                            Main.notify("Unable to logout from actual session");
                            return;
                        }
                    });
                }
    
            return Clutter.EVENT_PROPAGATE;
        }    

        setupTimer() {
            this._startTime = GLib.get_monotonic_time();                         

            // get remained time
            this.session.get_remaining_time_async(null, (_, r) => {
                try {
                    this._totalTime = this.session.get_remaining_time_finish(r);
                } catch (e) {
                    this._totalTime = null;
                }
            });

            const info = this.settings.get_string("time-info");
            if (info != "none") {
                // timer update
                this._refreshTimerConnectionId = Mainloop.timeout_add_seconds(1.0, (self) => {
                    this.updateTimer();
                    return true;
                });
            }
        }

        updateTimer() {
            let seconds = Math.max((GLib.get_monotonic_time() - this._startTime) / (1000 * 1000), 0);

            if (seconds <= 0 && !this._notified) {
                // Notify limits
                Main.notify("The connection time has finished");
                this._notified = true;
                // this.add_style_class_name("box-error");
            }

            const info = this.settings.get_string("time-info");

            if (info == 'remain' && this._totalTime == null) {
                this._label.text = '   No Available :(';
            } else {
                if (info == 'remain')
                    seconds = this._totalTime - seconds;

                const text = "   %02d:%02d:%02d".format(seconds / 3600, (seconds / 60) % 60, seconds % 60);
                this._label.text = text;
            }
        }

        destroy() {
            this.quickSettingsItems.forEach(item => item.destroy());

            if (this._connectedConnectionId != null) {
                this.settings.disconnect(this._connectedConnectionId);
                this._connectedConnectionId = null;
            }
            this.destroyTimer();
            // super.destroy();
        }

        destroyTimer() {
            if (this._refreshTimerConnectionId != null) {
                Mainloop.source_remove(this._refreshTimerConnectionId);
                this._refreshTimerConnectionId = null;
            }
        }
    }
);

class Extension {
    constructor(uuid) {
        this._uuid = uuid;
        ExtensionUtils.initTranslations(GETTEXT_DOMAIN);
    }

    enable() {
        this._indicator = new NautaIndicator(this._uuid);
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }
}

function init(meta) {
    return new Extension(meta.uuid);
}