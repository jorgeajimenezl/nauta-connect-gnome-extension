import Soup from 'gi://Soup?version=3.0';
import GLib from 'gi://GLib';
import GXml from 'gi://GXml';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

const NAUTA_LOGIN_URI = 'https://secure.etecsa.net:8443/';
const _TEXT_DECODE = new TextDecoder();

export const NautaSession = GObject.registerClass({
    GTypeName: 'NautaSession'
}, class NautaSession extends GObject.Object {
    /**
     * @param {Gio.Settings} username
     */
    _init(settings = null) {
        super._init({});
        this.session = new Soup.Session();

        // I don't know why I'd do this, but without this piece of shit doesn't works
        // PD: I love u ETECSA ❤️‍🩹️
        this.session.add_feature(new Soup.CookieJar()); 

        this.settings = settings;
        this.csrfhw = null;
        this.wlanuserip = null;
        this.attribute_uuid = null;
        this.username = null;
        this.connected = false;

        if (this.settings != null)
            this.load();
    }

    /**
     * Login with the given username and password
     * 
     * @param {string} username
     * @param {string} password
     * @param {Gio.Cancellable} cancellable
     * @param {{ (o: any, r: any): void; (source_object: any, res: Gio.Task): void; }} callback     
     */
    login_async(username, password, cancellable, callback) {
        let task = Gio.Task.new(this, cancellable, callback);

        if (this.connected) {
            task.return_boolean(true);
            return;
        }        
        
        this.session.send_and_read_async(Soup.Message.new('GET', NAUTA_LOGIN_URI), 
                                        0, cancellable, (_, r1) => {
            try {
                let x = this.session.send_and_read_finish(r1);
                if (x == null) {
                    task.return_error(GLib.Error.new_literal(
                        GLib.quark_from_string('NautaSessionError'), 1, 'Unable to connect with ETECSA portal'));
                    return;
                }
                var content = _TEXT_DECODE.decode(x.get_data());
                let element = GXml.XHtmlDocument.from_string(content, 32)
                                                .get_element_by_id('formulario');        
                let inputs = element.get_elements_by_tag_name('input');
                let map = {}; 

                for (let i = 0; i < inputs.get_length(); i++) {
                    let e = inputs.get_element(i);
                    if (e.get_attribute('type') == 'hidden')
                        map[e.get_attribute('name').toLowerCase()] = e.get_attribute('value');
                }
                
                // set properties
                let login_uri = element.get_attribute('action');
                this.csrfhw = map['csrfhw'];
                this.wlanuserip = map['wlanuserip'];

                let message = Soup.Message.new_from_encoded_form('POST', login_uri, Soup.form_encode_hash({
                    'CSRFHW': this.csrfhw,
                    'wlanuserip': this.wlanuserip,
                    'username': username,
                    'password': password,
                }));
                                
                this.session.send_and_read_async(message, 0, cancellable, (_, r2) => {
                    try {
                        if (message.status_code < 200 || 299 < message.status_code) {
                            task.return_error(GLib.Error.new_literal(
                                            GLib.quark_from_string('NautaSessionError'), 1, message.get_reason_phrase()));
                            return;
                        }
                        let m = this.session.send_and_read_finish(r2);
                        var matches = this._decoder.decode(m.get_data()).match('ATTRIBUTE_UUID=([^&]+)');
                        if (matches == null) {
                            task.return_error(GLib.Error.new_literal(
                                GLib.quark_from_string('NautaSessionError'), 1, 'Unable to get connection identifier'));
                            return;
                        }
                        this.attribute_uuid = matches[1];        
                        this.connected = true;
                        this.username = username;

                        if (this.settings != null)
                            this.save();
                        task.return_boolean(true);
                    } catch (e) {
                        console.error(e);
                        task.return_error(e);
                        return;
                    }
                });
            } catch (e) {
                console.error(e);
                task.return_error(e);
                return;
            }
        });      
    };

    save() {
        this.settings.set_string('session-csrfhw', this.csrfhw);
        this.settings.set_string('session-wlanuserip', this.wlanuserip);
        this.settings.set_string('session-attribute-uuid', this.attribute_uuid);
        this.settings.set_string('session-username', this.username);
        this.settings.set_boolean('session-connected', this.connected);
    }

    load() {
        this.csrfhw = this.settings.get_string('session-csrfhw');
        this.wlanuserip = this.settings.get_string('session-wlanuserip');
        this.attribute_uuid = this.settings.get_string('session-attribute-uuid');
        this.username = this.settings.get_string('session-username');
        this.connected = this.settings.get_boolean('session-connected');
    }

    /**
     * @param {Gio.Task} result
     * @returns {Boolean} If the login was successful or not
     */
    login_finish(result) {
        return result.propagate_boolean();
    }

    /**
     * Logout from the opened session
     * 
     * @param {Gio.Cancellable} cancellable
     * @param {{ (o: any, r: any): void; (source_object: NautaSession, res: Gio.Task): void; }} callback     
     */
    logout_async(cancellable, callback) {
        let task = Gio.Task.new(this, cancellable, callback);

        if (!this.connected) {
            task.return_boolean(true);
            return;
        }

        let message = Soup.Message.new_from_encoded_form('GET', NAUTA_LOGIN_URI + 'LogoutServlet', Soup.form_encode_hash({
            'CSRFHW': this.csrfhw,
            'wlanuserip': this.wlanuserip,
            'username': this.username,
            'ATTRIBUTE_UUID': this.attribute_uuid,
        }));
        
        this.session.send_and_read_async(message, 0, cancellable, (_, r) => {
            try {
                if (message.status_code < 200 || 299 < message.status_code) {
                    task.return_error(GLib.Error.new_literal(
                                    GLib.quark_from_string('NautaSessionError'), 2, message.get_reason_phrase()));
                    return;
                }

                this.connected = false;
                if (this.settings != null)
                    this.save();
                task.return_boolean(true);                
            } catch (e) {
                task.return_error(e);
                return;
            }
        });
    }

    /**
     * @param {Gio.Task} result
     * @returns {Boolean} If the logout operation was successful or not
     */
    logout_finish(result) {
        return result.propagate_boolean();
    }

    /**
     * Get the time remained
     * 
     * @param {Gio.Cancellable} cancellable
     * @param {Gio.AsyncReadyCallback<any>} callback     
     */
    get_remaining_time_async(cancellable, callback) {
        let task = Gio.Task.new(this, cancellable, callback);

        if (!this.connected) {
            task.return_error(GLib.Error.new_literal(
                GLib.quark_from_string('NautaSessionError'), 2, "Unable to get information in desconnected state"));
            return;
        }

        let message = Soup.Message.new_from_encoded_form('POST', NAUTA_LOGIN_URI + 'EtecsaQueryServlet', Soup.form_encode_hash({
            "op": "getLeftTime",
            'CSRFHW': this.csrfhw,
            'wlanuserip': this.wlanuserip,
            'username': this.username,
            'ATTRIBUTE_UUID': this.attribute_uuid,
        }));
        
        this.session.send_and_read_async(message, 0, cancellable, (_, r) => {
            try {
                if (message.status_code < 200 || 299 < message.status_code) {
                    task.return_error(GLib.Error.new_literal(
                                    GLib.quark_from_string('NautaSessionError'), 2, message.get_reason_phrase()));
                    return;
                }

                let time_text = this._decoder.decode(this.session.send_and_read_finish(r).get_data());
                if (time_text == null) {
                    task.return_error(GLib.Error.new_literal(
                        GLib.quark_from_string('NautaSessionError'), 2, "Unable to parse the response from the server"));
                    return;
                }
                let m = time_text.match('([0-9]+):([0-9]+):([0-9]+)').map((x) => {
                    return parseInt(x);
                });
                task.return_int(m[1] * 60 * 60 + m[2] * 60 + m[3]);
            } catch (e) {
                console.error(e);
                task.return_error(e);
                return;
            }
        });
    }

    /**
     * @param {Gio.Task} result   
     * @returns {Number} Time in seconds that remain in the account
     */
    get_remaining_time_finish(result) {
        return result.propagate_int();
    }
});