import Gio from 'gi://Gio';

const UPOWER_IFACE = `
<node>
  <interface name="org.freedesktop.UPower">
    <property name="OnBattery" type="b" access="read"/>
  </interface>
</node>`;

const UPowerProxy = Gio.DBusProxy.makeProxyWrapper(UPOWER_IFACE);

/**
 * Watches UPower for whether the machine is running on battery.
 *
 * The proxy is built asynchronously, so `onBattery` reads false until the system
 * bus answers — a desktop with no battery never answers differently, and a laptop
 * settles within a frame or two of enable.
 */
export class PowerMonitor {
    constructor(onChanged) {
        this._onChanged = onChanged;
        this._proxy = null;
        this.onBattery = false;

        new UPowerProxy(
            Gio.DBus.system,
            'org.freedesktop.UPower',
            '/org/freedesktop/UPower',
            (proxy, error) => {
                if (error) {
                    console.warn(`[WallpaperEngine] UPower unavailable: ${error.message}`);
                    return;
                }
                this._proxy = proxy;
                this._update();
                proxy.connectObject('g-properties-changed', () => this._update(), this);
            }
        );
    }

    _update() {
        const next = !!this._proxy?.OnBattery;
        if (next === this.onBattery) return;
        this.onBattery = next;
        this._onChanged?.();
    }

    destroy() {
        this._proxy?.disconnectObject(this);
        this._proxy = null;
        this._onChanged = null;
    }
}
