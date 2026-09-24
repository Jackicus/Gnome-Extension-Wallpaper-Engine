import Gio from 'gi://Gio';
import St from 'gi://St';

// The system's say in whether the patterns move: the power source, the power
// profile, and whether animations are on at all. The last two are choices the
// user made for everything, so the patterns follow them without being asked;
// the battery only counts with pause-on-battery.

const UPower = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="org.freedesktop.UPower">
    <property name="OnBattery" type="b" access="read"/>
  </interface>
</node>`);

// power-profiles-daemon took a name under UPower in 0.20; older releases still
// answer to the one they started with.
const PROFILES = [
    ['org.freedesktop.UPower.PowerProfiles', '/org/freedesktop/UPower/PowerProfiles'],
    ['net.hadess.PowerProfiles', '/net/hadess/PowerProfiles'],
].map(([name, path]) => ({
    name,
    path,
    Proxy: Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="${name}">
    <property name="ActiveProfile" type="s" access="read"/>
  </interface>
</node>`),
}));

export class SystemState {
    /** `onChanged` is called whenever any of the three changes. */
    constructor(onChanged) {
        this._onChanged = onChanged;
        this._proxies = [];
        this._cancellable = new Gio.Cancellable();

        const settings = St.Settings.get();
        this.animations = settings.enable_animations;
        this.onBattery = false;
        this.powerSaver = false;

        settings.connectObject('notify::enable-animations',
            () => this._set('animations', settings.enable_animations), this);

        // Both proxies are built asynchronously, so the first answer arrives a
        // moment after enable -- a desktop with no battery and no profiles
        // daemon simply never answers differently.
        this._watch(UPower, 'org.freedesktop.UPower', '/org/freedesktop/UPower',
            proxy => this._set('onBattery', !!proxy.OnBattery));
        this._watchProfiles(0);
    }

    destroy() {
        this._cancellable.cancel();
        St.Settings.get().disconnectObject(this);
        for (const proxy of this._proxies) proxy.disconnectObject(this);
        this._proxies = [];
        this._onChanged = null;
    }

    _watchProfiles(index) {
        const { Proxy, name, path } = PROFILES[index];
        this._watch(Proxy, name, path, proxy => this._set('powerSaver', proxy.ActiveProfile === 'power-saver'),
            proxy => {
                // Nobody owns the new name: try the old one.
                if (proxy.g_name_owner === null && index + 1 < PROFILES.length) {
                    this._forget(proxy);
                    this._watchProfiles(index + 1);
                }
            });
    }

    _watch(Proxy, name, path, read, ready = () => {}) {
        new Proxy(Gio.DBus.system, name, path, (proxy, error) => {
            if (error) {
                if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.warn(`[WallpaperEngine] ${name} unavailable: ${error.message}`);
                return;
            }
            if (this._cancellable.is_cancelled()) return;
            this._proxies.push(proxy);
            proxy.connectObject('g-properties-changed', () => read(proxy), this);
            read(proxy);
            ready(proxy);
        }, this._cancellable, Gio.DBusProxyFlags.DO_NOT_AUTO_START);
    }

    _forget(proxy) {
        proxy.disconnectObject(this);
        this._proxies = this._proxies.filter(p => p !== proxy);
    }

    _set(key, value) {
        if (this[key] === value) return;
        this[key] = value;
        this._onChanged?.();
    }
}
