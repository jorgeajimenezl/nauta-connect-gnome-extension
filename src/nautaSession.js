import Soup from 'gi://Soup?version=3.0';
import GLib from 'gi://GLib';
import GXml from 'gi://GXml';
import Gio from 'gi://Gio';

const NAUTA_LOGIN_URL = "https://secure.etecsa.net:8443/";
const _TEXT_DECODE = new TextDecoder();

Gio._promisify(Soup.Session.prototype, "send_and_read_async", "send_and_read_finish");

export default class NautaSession {
    constructor(state = null) {
        this.state = state ===null ? {
            csrfhw: null,
            wlanuserip: null,
            login_url: null,
            auth: null,
        } : state;

        this.session = new Soup.Session();
        // I don't know why I'd do this, but without this piece of shit doesn't works
        // PD: I love u ETECSA ❤️‍🩹️
        this.session.add_feature(new Soup.CookieJar());
    }

    static from_settings(settings) {
        const state = {
            csrfhw: settings.get_string("session-csrfhw"),
            wlanuserip: settings.get_string("session-wlanuserip"),
            login_url: settings.get_string("session-login-url"),
            auth: settings.get_boolean("session-connected") 
                ? [settings.get_string("session-username"), settings.get_string("session-attribute-uuid")] 
                : null,
        };

        return new NautaSession(state);
    }

    save(settings) {
        settings.set_string("session-csrfhw", this.state.csrfhw);
        settings.set_string("session-wlanuserip", this.state.wlanuserip);
        settings.set_string("session-login-url", this.state.login_url);
        settings.set_boolean("session-connected", this.is_connected);
        if (this.is_connected) {
            settings.set_string("session-username", this.state.auth[0]);
            settings.set_string("session-attribute-uuid", this.state.auth[1]);
        } else {
            settings.set_string("session-username", "");
            settings.set_string("session-attribute-uuid", "");
        }
    }

    async build_session() {
        let res = await this.session.send_and_read_async(
            Soup.Message.new("GET", NAUTA_LOGIN_URL),
            GLib.PRIORITY_DEFAULT,
            null
        );

        let content = _TEXT_DECODE.decode(res.get_data());
        let formulario = GXml.XHtmlDocument.from_string(content, 32)
            .query_selector("#formulario");
        let inputs = formulario.query_selector_all("input[type=\"hidden\"]");
        let map = {};

        for (let i = 0; i < inputs.get_length(); i++) {
            let e = inputs.item(i);
            map[e.get_attribute("name").toLowerCase()] = e.get_attribute("value");
        }

        this.state.csrfhw = map["csrfhw"];
        this.state.wlanuserip = map["wlanuserip"];
        this.state.login_url = formulario.get_attribute("action");
    }

    get is_connected() {
        return this.state.auth !== null;
    }

    get is_valid_session() {
        return this.state.csrfhw !== null && this.state.csrfhw !== "";
    }

    async _send_request(base, path, form) {
        let state_form = {
            "CSRFHW": this.state.csrfhw,
            "wlanuserip": this.state.wlanuserip,
            ...form,
        };

        let url = `${base}${path}`;

        if (this.is_connected) {
            let [username, uuid] = this.state.auth;
            state_form["username"] = username;
            state_form["ATTRIBUTE_UUID"] = uuid;
        }

        let message = Soup.Message.new_from_encoded_form(
            "POST",
            url,
            Soup.form_encode_hash(state_form)
        );

        let res = await this.session.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            null
        );

        if (message.status_code < 200 || 299 < message.status_code) {
            throw new Error(`Unknown error (code: ${message.status_code} reason: ${message.get_reason_phrase()}`);
        }

        return [_TEXT_DECODE.decode(res.get_data()), message];
    }

    async login(username, password) {
        if (this.is_connected)
            return;

        if (!this.is_valid_session)
            await this.build_session();
        
        let [res, msg] = await this._send_request(
            this.state.login_url,
            "", {
                "username": username,
                "password": password,
            }
        );

        if (!msg.get_uri().to_string().includes("online.do")) {
            let dom = GXml.XHtmlDocument.from_string(res, 32);
            let scripts = dom.query_selector_all("script");
            let len = scripts.get_length();

            if (len >= 0) {
                let script = scripts.item(len - 1).to_string();
                let m = script.match("alert\(\"([^\"]*?)\"\)");
                if (m === null)
                    throw new Error("Unknown Error");
                else
                    throw new Error(`Nauta Error (reason: ${m[1]})`);
            } else {
                throw new Error("Unknown Error");
            }
        }

        let m = res.match("ATTRIBUTE_UUID=([^&]+)");
        if (m === 1)
            throw new Error("Nauta Error: Invalid response (without connection identifier)")
        this.state.auth = [username, m[1]];
    }

    async logout() {
        if (!this.is_connected)
            return;

        await this._send_request(NAUTA_LOGIN_URL, "LogoutServlet", {});
        this.state.auth = null;
    }

    async user_credits(username, password) {
        let [res, _] = await this._send_request(
            NAUTA_LOGIN_URL,
            "EtecsaQueryServlet", {
                "username": username,
                "password": password,
            }
        );

        let dom = GXml.XHtmlDocument.from_string(res, 32);
        let credit_tag = dom.query_selector("#sessioninfo > tbody:nth-child(1) > tr:nth-child(2) > td:nth-child(2)");
        return credit_tag.to_string().trim();
    }

    async remaining_time() {
        if (!this.is_connected)
            return null;

        let [res, _] = await this._send_request(
            NAUTA_LOGIN_URL,
                "EtecsaQueryServlet", {
                "op": "getLeftTime",
            }
        );

        let time = res.split(":").map(x => parseInt(x));
        if (time.every(x => isNaN(x)))
            throw new Error("Nauta Error: Time format must be 00:00:00");

        return time[0] * 3600 + time[1] * 60 + time[2];
    }
}