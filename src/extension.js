import GObject from 'gi://GObject';
import St from 'gi://St';
import Secret from 'gi://Secret';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Atk from 'gi://Atk';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

import NautaSession from './nautaSession.js';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

let _notifSource = null;
let ETECSA_ICON = null;

function formatTimeString(seconds) {
    return "%02d:%02d:%02d".format(
        seconds / 3600,
        (seconds / 60) % 60,
        seconds % 60
    );
}

const NautaConnectNotificationSource = GObject.registerClass(
class NautaConnectNotificationSource extends MessageTray.Source {
    _init() {
        super._init("Nauta Connect", null);
    }
    open() {
        this.destroy();
    }
    createIcon(size) {
        return new St.Icon({
            gicon: ETECSA_ICON,
            icon_size: size,
        });
    }
});

function _initNotifSource () {
    if (!_notifSource) {
        _notifSource = new NautaConnectNotificationSource();
        _notifSource.connect('destroy', () => {
            _notifSource = null;
        });
        Main.messageTray.add(_notifSource);
    }
}

function _showNotification (message, details, transformFn) {
    let notification = null;
    _initNotifSource();

    if (_notifSource.count === 0) {
        notification = new MessageTray.Notification(_notifSource, message);
    }
    else {
        notification = _notifSource.notifications[0];
        notification.update(message, details, { clear: true });
    }

    if (typeof transformFn === 'function') {
        transformFn(notification);
    }

    notification.setTransient(true);
    _notifSource.showNotification(notification);
}

class UserMenuItem {
    constructor(user, panel) {
        this.user = user;
        this.item = new PopupMenu.PopupMenuItem(user.username);
        this.panel = panel;

        panel.settings.bind(
            "session-connected",
            this.item, "visible",
            Gio.SettingsBindFlags.GET | Gio.SettingsBindFlags.INVERT_BOOLEAN
        );

        this._connectionId = this.item.connect("activate", () => {
            panel.settings.set_string("current-username", user.username);
        });
    }

    async login() {
        try {
            await this.panel.session.login(this.user.username, this.user.password);
            this.panel.session.save(this.panel.settings);
            _showNotification(_("Logged successful"), this.user.username);
        } catch (e) {
            _showNotification(_("Unable to login right now"));
            console.error(e);
        }

        this.panel._updateChecked();
    }

    destroy() {
        if (this._connectionId != null) {
            this.item.disconnect(this._connectionId);
            this._connectionId = null;
        }
        this.item.destroy();
    }
}

const NautaMenuToggle = GObject.registerClass(
    class NautaMenuToggle extends QuickSettings.QuickMenuToggle {
        _init(extensionObject, session) {
            this.session = session;

            this._extensionObject = extensionObject;
            this.settings = extensionObject.getSettings();

            this._changedUserConnectionId = null;
            this._clickedConnectionId = null;
            this.items = [];

            super._init({
                title: _("Nauta"),
                gicon: ETECSA_ICON,
                toggleMode: true,
            });

            this.menu.setHeader(ETECSA_ICON, _("Nauta Connect"), _("Authenticate in ETECSA network"));
            this._updateChecked();

            // Populate the list of users            
            this.buildMenu();

            // Setup logout action
            this._clickedConnectionId = this.connect(
                "clicked", () => {
                    const username = this.settings.get_string("current-username");
                    const connected = this.settings.get_boolean("session-connected");

                    if (!connected) {
                        for (const item of this.items) {
                            if (item.user.username == username) {
                                console.log(`Trying to login with: ${username}`);
                                item.login();
                            }
                        }
                    } else {
                        // Logout   
                        console.log(_("Trying to logout"));
                        this.session.logout().then(
                            () => {
                                _showNotification(_("Session closed successfully"));
                                this.session.save(this.settings);
                                this._updateChecked();
                            },
                            (e) => {
                                console.error(e);
                                _showNotification(_("Unable to logout from actual session"));
                                this._updateChecked();
                            }
                        );
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
                            (username === userItem.user.username) ? PopupMenu.Ornament.DOT
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

            super.destroy();
        }

        _updateChecked() {
            this.checked = this.session.is_connected;
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

                    const item = new UserMenuItem({
                        username: user,
                        password: pass
                    }, this);

                    item.item.setOrnament(
                        (username === user) ? PopupMenu.Ornament.DOT
                            : PopupMenu.Ornament.NONE);

                    this.items.push(item);
                    this.menu.addMenuItem(item.item);
                }

                // Setup setting
                // FIX: Need to push this code here coz if
                // not, the order is random (async)
                this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                const settingsItem = this.menu.addAction("Settings", () => this._extensionObject.openPreferences());
                settingsItem.visible = Main.sessionMode.allowSettings;
                this.menu._settingsActions[this._extensionObject.uuid] = settingsItem;
            });
        }
    }
);

const NautaIndicator = GObject.registerClass(
    class NautaIndicator extends PanelMenu.Button {
        _init(extensionObject) {
            super._init({
                reactive: true,
                can_focus: true,
                track_hover: true,
                accessible_role: Atk.Role.PUSH_BUTTON,
            });
            this.add_style_class_name("nauta-indicator");

            this.settings = extensionObject.getSettings();
            this.session = NautaSession.from_settings(this.settings);
            this.quickSettingsItems = [];

            this._extensionObject = extensionObject;
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
            this.quickSettingsItems.push(new NautaMenuToggle(extensionObject, this.session));

            // Add the indicator to the panel and the toggle to the menu
            Main.panel.addToStatusArea(extensionObject.uuid, this);
            Main.panel.statusArea.quickSettings.addExternalIndicator(this);
        }

        buildUI() {
            this._box = new St.BoxLayout();
            this.add_child(this._box);

            this._label = new St.Label({
                text: "",
                y_align: Clutter.ActorAlign.CENTER,
                margin_left: 2.0,
                visible: true,
            });

            this._box.add_child(this._label);
            this._icon = new St.Icon({ icon_name: "window-close-symbolic" });
            this._box.add_child(this._icon);
            const connected = this.settings.get_boolean("session-connected");

            if (connected) {
                this.show();
                this.setupTimer();
            } else {
                this.hide();
            }
        }

        async _logout() {
            try {
                await this.session.logout();
                this.session.save(this.settings);
                this.quickSettingsItems.forEach(item => item._updateChecked());
                _showNotification(_("Session closed successfully"));
            } catch (e) {
                console.error(e);               
                this.quickSettingsItems.forEach(item => item._updateChecked());
                _showNotification(_("Unable to logout from actual session"));
            }
        }

        vfunc_event(event) {
            if (event.type() === Clutter.EventType.TOUCH_BEGIN ||
                event.type() === Clutter.EventType.BUTTON_PRESS) {
                console.log(_("Trying to logout"));
                this._logout();
            }

            return Clutter.EVENT_PROPAGATE;
        }

        async setupTimer() {
            this._startTime = GLib.get_monotonic_time();

            try {
                this._totalTime = await this.session.remaining_time();
            } catch (e) {
                console.warn("Unable to get the remaining time in this session");
                this._totalTime = null;
            }

            const info = this.settings.get_string("time-info");
            if (info != "none") {
                // timer update
                this._refreshTimerConnectionId = GLib.timeout_add_seconds(
                    GLib.PRIORITY_DEFAULT, 1.0, () => {
                        this.updateTimer();
                        return true;
                    });
            }
        }

        updateTimer() {
            let seconds = Math.max((GLib.get_monotonic_time() - this._startTime) / (1000 * 1000), 0);

            if (seconds <= 0 && !this._notified) {
                // Notify limits
                _showNotification("The connection time has finished");
                this._notified = true;
                // this.add_style_class_name("box-error");
            }

            const info = this.settings.get_string("time-info");

            if (info === "remain" && this._totalTime == null) {
                this._label.text = "No Available :(";
            } else {
                if (info === "remain")
                    seconds = this._totalTime - seconds;

                this._label.text = formatTimeString(seconds);
            }
        }

        destroy() {
            this.quickSettingsItems.forEach(item => item.destroy());

            if (this._connectedConnectionId != null) {
                this.settings.disconnect(this._connectedConnectionId);
                this._connectedConnectionId = null;
            }
            this.destroyTimer();
            super.destroy();
        }

        destroyTimer() {
            if (this._refreshTimerConnectionId != null) {
                GLib.source_remove(this._refreshTimerConnectionId);
                this._refreshTimerConnectionId = null;
            }
        }
    }
);

export default class NautaConnectExtension extends Extension {
    enable() {
        ETECSA_ICON = Gio.icon_new_for_string(this.path + '/icons/etecsa-symbolic.svg');
        this._indicator = new NautaIndicator(this);
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }
}