import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';
import Secret from 'gi://Secret';
import Gio from 'gi://Gio';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const AccountItemWidget = GObject.registerClass({
    GTypeName: 'AccountItemWidget',
    Template: GLib.uri_resolve_relative(import.meta.url, 'ui/account-item-widget.ui', GLib.UriFlags.NONE),
    InternalChildren: ['userEntry', "passwordEntry", "editButton"]
}, class AccountItemWidget extends Gtk.ListBoxRow {
    _init(window, container, account = null) {
        super._init();

        this.window = window;
        this.container = container;
        this.ready = (account != null);
        this.uuid = this.ready ? account.uuid : GLib.uuid_string_random();
        this.saved = this.ready;

        if (this.ready) {
            this._userEntry.text = account.username;
            this._passwordEntry.text = account.password;
        } else {
            this._editButton.icon_name = 'document-save-symbolic';
            this._passwordEntry.visible = true;
            this._userEntry.sensitive = true;
        }
    }

    _onEdit() {
        if (!this.ready) {
            // Save
            const schema = Secret.Schema.new('org.jorgeajimenezl.nauta-connect.NetworkCredentials', 
                Secret.SchemaFlags.DONT_MATCH_NAME, {
                    "uuid": Secret.SchemaAttributeType.STRING,
                    "application": Secret.SchemaAttributeType.STRING,
                }
            );

            Secret.password_store(schema, {
                'uuid': this.uuid,
                'application': 'org.jorgeajimenezl.nauta-connect'
            }, Secret.COLLECTION_DEFAULT, this._userEntry.text, this._passwordEntry.text, null, (_, r) => {
                let x = Secret.password_store_finish(r);
                if (x) {
                    this._userEntry.sensitive = false;
                    this._passwordEntry.visible = false;
                    this._editButton.icon_name = 'document-properties-symbolic';
                    this.ready = true;
                    this.saved = true;
                } else {
                    let dialog = new Gtk.MessageDialog({
                        title: 'Warning',
                        text: _('Unable to connect with secrets service'),
                        buttons: [Gtk.ButtonsType.NONE],
                        transient_for: this.window,
                        message_type: Gtk.MessageType.WARNING,
                        modal: true,
                    });
                    dialog.add_button('OK', Gtk.ResponseType.OK);
                    dialog.connect('response', () => {
                        dialog.destroy();
                    });
                    dialog.show();
                }
            });
        } else {
            this._userEntry.sensitive = true;
            this._passwordEntry.visible = true;
            this._editButton.icon_name = 'document-save-symbolic';
            this.ready = false;
        }
    }

    _onDelete() {
        var erase = () => {
            this.container.remove(this);
        };

        if (this.saved) {
            const schema = Secret.Schema.new('org.jorgeajimenezl.nauta-connect.NetworkCredentials', 
                Secret.SchemaFlags.DONT_MATCH_NAME, {
                    "uuid": Secret.SchemaAttributeType.STRING,
                    "application": Secret.SchemaAttributeType.STRING,
                }
            );

            Secret.password_clear(schema, {
                'uuid': this.uuid,
                'application': 'org.jorgeajimenezl.nauta-connect'
            }, null, erase);
        } else {
            erase();
        }
    }

    _onEntryChanged() {
        if (this._userEntry.text.trim() == "" ||
            this._passwordEntry.text.trim() == "")
            this._editButton.sensitive = false;
        else
            this._editButton.sensitive = true;
    }
});

const AccountsWindow = GObject.registerClass({
    GTypeName: 'AccountsWindow',
    Template: GLib.uri_resolve_relative(import.meta.url, 'ui/accounts-window.ui', GLib.UriFlags.NONE),
    InternalChildren: ['accountList']
}, class AccountsWindow extends Gtk.Window {
    _init(params = {}) {
        super._init(params);
        // window.resize(700, 900);
        this.default_height = 400;
        this.default_width = 600;

        let headerBar = new Gtk.HeaderBar();
        let box = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 10
        });
        box.append(Gtk.Image.new_from_icon_name('contact-new-symbolic'));
        box.append(Gtk.Label.new('Add user'));

        let button = new Gtk.Button({
            child: box
        });

        button.connect('clicked', () => {
            this._accountList.append(new AccountItemWidget(this, this._accountList));
        });

        headerBar.pack_end(button);
        this.set_titlebar(headerBar);

        // populate the list
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
                let uuid = x[i].get_attributes()['uuid'];

                this._accountList.append(new AccountItemWidget(this, this._accountList, {
                    username: user,
                    password: pass,
                    uuid: uuid
                }));
            }
        });
    }
});

const PrefsWidget = GObject.registerClass({
    GTypeName: 'PrefsWidget',
    Template: GLib.uri_resolve_relative(import.meta.url, 'ui/prefs-widget.ui', GLib.UriFlags.NONE),
    InternalChildren: ['timeInfoComboBox', 'notifyLimitsSwitch']
}, class PrefsWidget extends Gtk.Box {

    _init(extensionObject, params = {}) {
        super._init(params);

        this._extensionObject = extensionObject;

        this.settings = extensionObject.getSettings();
        this.settings.bind('time-info', this._timeInfoComboBox, 'active-id', Gio.SettingsBindFlags.DEFAULT);
        this.settings.bind('notifications-limits', this._notifyLimitsSwitch, 'state', Gio.SettingsBindFlags.DEFAULT);

        this.connect('realize', () => {
            this.window = this.get_root();

            this.window.default_width = 400;
            this.window.default_height = 400;
            // window.resize(700, 900);

            let headerBar = new Gtk.HeaderBar();
            let button = Gtk.Button.new_from_icon_name('dialog-information-symbolic');

            button.connect('clicked', () => {
                let aboutDialog = new Gtk.AboutDialog({
                    authors: [
                        'Jorge Alejandro Jimenez Luna <jorgeajimenezl17@gmail.com>',
                    ],
                    // translator_credits: _('translator-credits'),
                    program_name: _('Nauta Connect'),
                    comments: _('Utility to authenticate in ETECSA network'),
                    license_type: Gtk.License.GPL_2_0,
                    // logo_icon_name: Package.name,
                    version: "0.0.1",

                    transient_for: this.window,
                    modal: true,
                });
                aboutDialog.show();
            });

            headerBar.pack_end(button);
            // this.window.set_titlebar(headerBar);
        });
    }

    _onAccountEdit() {
        let window = new AccountsWindow({
            transient_for: this.window
        });

        window.show();
    }
});

export default class ExamplePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window._settings = this.getSettings();

        let widget = new PrefsWidget(this);

        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'dialog-information-symbolic',
        });

        const group = new Adw.PreferencesGroup({
            title: _('Appearance'),
            description: _('Configure the appearance of the extension'),
        });

        group.add(widget);
        page.add(group);
        window.add(page);
        window.set_default_size(widget.width, widget.height);
        widget.show();
    }
}