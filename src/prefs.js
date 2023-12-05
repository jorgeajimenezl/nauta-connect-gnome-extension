import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Secret from 'gi://Secret';
import Gio from 'gi://Gio';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

Gio._promisify(Adw.MessageDialog.prototype, "choose", "choose_finish");

function showError(window, title, retry_func) {
    let toast = new Adw.Toast({
        title: title,
        priority: Adw.ToastPriority.HIGH,
    });
    
    if (retry_func !== undefined) {
        toast.set_button_label(_("Retry"));
        toast.connect("button-clicked", () => {
            retry_func();
        });
    }

    window.add_toast(toast);
}

const AccountDetails = GObject.registerClass({
    GTypeName: "AccountDetails",
    Template: GLib.uri_resolve_relative(import.meta.url, "ui/account-details.ui", GLib.UriFlags.NONE),
    InternalChildren: ["cancel_btn", "accept_btn", "user_entry", "pass_entry"],
    Properties: {
        'accept-label': GObject.ParamSpec.string(
            'accept-label',
            'Accept Label',
            'A label to show in accept button',
            GObject.ParamFlags.READWRITE,
            "Accept",
        ),
        'username': GObject.ParamSpec.string(
            'username',
            'Username',
            'Username of the account',
            GObject.ParamFlags.READWRITE,
            "",
        ),
        'password': GObject.ParamSpec.string(
            'password',
            'Password',
            'Password of the account',
            GObject.ParamFlags.READWRITE,
            "",
        ),
    },
}, class AccountDetails extends Adw.Window {
    _init(params = {}) {
        this._username = "";
        this._password = "";
        this._accept_label = "";

        super._init(params);        
    }

    set username(value) {
        if (this._username === value)
            return;
        this._username = value;
        this.notify("username");

        if (!value.endsWith("@nauta.com.cu") && 
            !value.endsWith("@nauta.co.cu")) {
            this._user_entry.add_css_class("error");
        } else {
            this._user_entry.remove_css_class("error");
        }            
    }

    get username() {
        return this._username;
    }

    set password(value) {
        if (this._password === value)
            return;
        this._password = value;
        this.notify("password");

        if (value.length === 0) {
            this._pass_entry.add_css_class("error");
        } else {
            this._pass_entry.remove_css_class("error");
        } 
    }

    get password() {
        return this._password;
    }

    set accept_label(value) {
        if (this._accept_label === value)
            return;
        this._accept_label = value;
        this.notify("accept-label");
    }

    get accept_label() {
        return this._accept_label;
    }

    async present_async() {
        let ids = [];
        const res = await new Promise((resolve, ) => {
            ids.push(this._cancel_btn.connect("clicked", () => {
                resolve(null);             
            }));
            ids.push(this._accept_btn.connect("clicked", () => {
                if (!this.username.endsWith("@nauta.com.cu") && 
                    !this.username.endsWith("@nauta.co.cu"))
                    return;
                if (this.password.length === 0)
                    return;

                resolve({
                    username: this.username,
                    password: this.password,
                });              
            }));
            ids.push(this.connect("close-request", () => {
                resolve(null);
            }));

            this.present();
        });
        this._cancel_btn.disconnect(ids[0]);
        this._accept_btn.disconnect(ids[1]);
        this.disconnect(ids[2]);
        this.visible = false;

        return res;
    }
});

const AccountItem = GObject.registerClass({
    GTypeName: "AccountItem",
    Template: GLib.uri_resolve_relative(import.meta.url, 'ui/account-item.ui', GLib.UriFlags.NONE),
    InternalChildren: ["copy_user_btn", "copy_pass_btn"]
}, class AccountItem extends Adw.ActionRow {
    _init(container, window, account) {
        super._init();
        
        this.window = window;
        this.container = container;
        this.account = account;

        this.updateTitle();
    }

    updateTitle() {
        this.title = this.account.username;
        this.subtitle = this.account.username.endsWith("@nauta.com.cu") 
            ? _("International") 
            : _("National");
    }

    async edit() {
        let dialog = new AccountDetails({
            username: this.account.username,
            password: this.account.password,
            accept_label: "Save",
            transient_for: this.window,
        });
        
        const res = await dialog.present_async();            
        if (res === null)
            return;

        this.account.username = res.username;
        this.account.password = res.password;
        
        this.save();
        this.updateTitle();
    }

    async delete() {
        let dialog = Adw.MessageDialog.new(
            this.window,
            _("Delete account?"),
            _("Do you want to delete the account").concat(` ${this.account.username}`),
        );

        dialog.add_response("cancel", _("Cancel"));
        dialog.add_response("delete", _("Delete"));
        dialog.set_response_appearance("delete", Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.set_default_response("cancel");
        dialog.set_close_response("cancel");

        const res = await dialog.choose(null);

        if (res === "delete") {
            const SECRET_MATCH_SCHEMA = Secret.Schema.new('org.jorgeajimenezl.nauta-connect.NetworkCredentials', 
                Secret.SchemaFlags.DONT_MATCH_NAME, {
                    "uuid": Secret.SchemaAttributeType.STRING,
                    "application": Secret.SchemaAttributeType.STRING,
                }
            );

            Secret.password_clear(SECRET_MATCH_SCHEMA, {
                "uuid": this.account.uuid,
                "application": 'org.jorgeajimenezl.nauta-connect'
            }, null, (__, r) => {
                try {
                    if (Secret.password_clear_finish(r)) {
                        this.container?.remove(this);
                    } else {
                        showError(
                            this.window, 
                            _("Delete operation failed"), 
                            () => this.delete(),
                        );
                    }
                } catch (e) {
                    console.warn(e);
                    showError(
                        this.window, 
                        _("Unable to connect with secrets service"), 
                        () => this.delete(),
                    );
                }
            });            
        }
    }

    save() {
        const SECRET_MATCH_SCHEMA = Secret.Schema.new('org.jorgeajimenezl.nauta-connect.NetworkCredentials', 
            Secret.SchemaFlags.DONT_MATCH_NAME, {
                "uuid": Secret.SchemaAttributeType.STRING,
                "application": Secret.SchemaAttributeType.STRING,
            }
        );

        Secret.password_store(
            SECRET_MATCH_SCHEMA, 
            {
                "uuid": this.account.uuid,
                "application": 'org.jorgeajimenezl.nauta-connect'
            }, 
            Secret.COLLECTION_DEFAULT, 
            this.account.username, 
            this.account.password, 
            null, 
            (__, r) => {
                try {
                    if (!Secret.password_store_finish(r)) {                     
                        showError(
                            this.window, 
                            _("Save operation failed"), 
                            () => this.delete(),
                        );
                    }
                } catch (e) {
                    console.warn(e);
                    showError(
                        this.window, 
                        _("Unable to connect with secrets service"), 
                        () => this.save(),
                    );
                }
            }
        );
    }    
});

const Accounts = GObject.registerClass({
    GTypeName: "Accounts",
    Template: GLib.uri_resolve_relative(import.meta.url, "ui/accounts.ui", GLib.UriFlags.NONE),
    InternalChildren: ["accountList"]
}, class Accounts extends Adw.PreferencesPage {
    _init(window, params = {}) {
        super._init(params);

        this.window = window;
        this.populateList();
    }

    populateList() {
        const SECRET_SEARCH_SCHEMA = Secret.Schema.new('org.jorgeajimenezl.nauta-connect.SearchNetworkCredentials',
            Secret.SchemaFlags.DONT_MATCH_NAME, {
            "application": Secret.SchemaAttributeType.STRING,
        });

        Secret.password_search(SECRET_SEARCH_SCHEMA, {
            "application": 'org.jorgeajimenezl.nauta-connect'
        }, Secret.SearchFlags.ALL | Secret.SearchFlags.UNLOCK | Secret.SearchFlags.LOAD_SECRETS, null, (__, r) => {
            try {
                let res = Secret.password_search_finish(r);

                console.log(`Found ${res.length} secrets`);
                for (let i = 0; i < res.length; i++) {
                    let user = res[i].get_label();
                    let pass = res[i].retrieve_secret_sync(null).get_text();
                    let uuid = res[i].get_attributes()["uuid"];

                    this._accountList.append(new AccountItem(this._accountList, this.window, {
                        username: user,
                        password: pass,
                        uuid: uuid
                    }));
                }
            } catch (e) {
                console.warn(e);
                showError(
                    this.window, 
                    _("Unable to connect with secrets service"), 
                    () => this.populateList(),
                );
            }            
        });
    }

    async onAddAccount() {
        let dialog = new AccountDetails({
            accept_label: _("Create"),
            transient_for: this.window,
        });
        
        const res = await dialog.present_async();
        
        if (res === null)
            return;
        
        let item = new AccountItem(this._accountList, this.window, {
            username: res.username,
            password: res.password,
            uuid: GLib.uuid_string_random(),
        });

        item.save();
        this._accountList.append(item);
    }
});

const General = GObject.registerClass({
    GTypeName: "General",
    Template: GLib.uri_resolve_relative(import.meta.url, "ui/general.ui", GLib.UriFlags.NONE),
    InternalChildren: ["tminfo_cmb"]
}, class General extends Adw.PreferencesPage {
    _init(window, params = {}) {
        super._init(params);
        window._settings.bind(
            "time-info-type", 
            this._tminfo_cmb, 
            "selected", 
            Gio.SettingsBindFlags.DEFAULT
        );
    }
});

const Behaviour = GObject.registerClass({
    GTypeName: "Behaviour",
    Template: GLib.uri_resolve_relative(import.meta.url, "ui/behaviour.ui", GLib.UriFlags.NONE),
    InternalChildren: ["notif_switch", "disconn_vpn_switch"]
}, class General extends Adw.PreferencesPage {
    _init(window, params = {}) {
        super._init(params);
        window._settings.bind(
            "notify-limits", 
            this._notif_switch, 
            "active", 
            Gio.SettingsBindFlags.DEFAULT
        );
        window._settings.bind(
            "disconnect-vpn", 
            this._disconn_vpn_switch, 
            "active", 
            Gio.SettingsBindFlags.DEFAULT
        );
    }
});

export default class NautaConnectPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window._settings = this.getSettings();

        window.add(new General(window));
        window.add(new Behaviour(window));
        window.add(new Accounts(window));

        window.search_enabled = true;
    }
}