const {
    Adw,
    GObject,
    Gtk,
    GLib,
    Secret,
    Gio
} = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const GETTEXT_DOMAIN = 'nauta-connect';
const UI_FOLDER = Me.dir.get_child('ui');
const Keyring = Me.imports.keyring;

const _ = ExtensionUtils.gettext;

const AccountItemWidget = GObject.registerClass({
    GTypeName: 'AccountItemWidget',
    Template: UI_FOLDER.get_child('account-item-widget.ui').get_uri(),
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
            // save
            Secret.password_store(Keyring.NETWORK_CREDENTIALS, {
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
            Secret.password_clear(Keyring.NETWORK_CREDENTIALS, {
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
    Template: UI_FOLDER.get_child('accounts-window.ui').get_uri(),
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
        Secret.password_search(Keyring.SEARCH_NETWORK_CREDENTIALS, {
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
    Template: UI_FOLDER.get_child('prefs-widget.ui').get_uri(),
    InternalChildren: ['timeInfoComboBox', 'notifyLimitsSwitch']
}, class PrefsWidget extends Gtk.Box {

    _init(params = {}) {
        super._init(params);

        this.settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.nauta-connect');
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

function init() {
    ExtensionUtils.initTranslations(GETTEXT_DOMAIN);
}

function buildPrefsWidget() {
    let widget = new PrefsWidget();
    return widget;
}
