/*
 * Weather O'Clock extension for GNOME Shell 45+
 * Copyright 2022-2023 Cleo Menezes Jr., 2020 Jason Gray (JasonLG1979)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * If this extension breaks your desktop you get to keep all of the pieces...
 */

import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import St from "gi://St";
import * as Weather from "resource:///org/gnome/shell/misc/weather.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

let panelWeather = null;
let topBox, statusArea, dateMenu, weather, network, networkIcon, _newClockLabel;
let timeoutID = 0;

export default class weatherOClock {
  enable() {
    if (!panelWeather) {
      statusArea = Main.panel.statusArea;
      dateMenu = statusArea.dateMenu;
      weather = new Weather.WeatherClient();
      network = Main.panel._network;
      networkIcon = network ? network._primaryIndicator : null;
      panelWeather = new PanelWeather(weather, networkIcon);

      topBox = new St.BoxLayout({
        style_class: "clock",
      });

      _newClockLabel = new St.Label({
        style_class: "clock-label",
      });
      _newClockLabel.text = dateMenu._clockDisplay.text;
      _newClockLabel.clutter_text.y_align = Clutter.ActorAlign.CENTER;

      topBox.add_child(panelWeather);
      topBox.add_child(_newClockLabel);

      dateMenu._clockDisplay
        .get_parent()
        .insert_child_below(topBox, dateMenu._clockDisplay);
      dateMenu._clockDisplay.hide();

      // Update _clockDisplay
      timeoutID = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, this.tick);
    }
  }

  tick() {
    _newClockLabel.set_text(dateMenu._clockDisplay.text);
    return true;
  }

  disable() {
    dateMenu._clockDisplay.get_parent().remove_child(topBox);
    dateMenu._clockDisplay.show();
    GLib.Source.remove(timeoutID);
    topBox = null;
    _newClockLabel = null;
    weather = null;
    if (panelWeather) {
      panelWeather.destroy();
      panelWeather = null;
    }
  }
}

const PanelWeather = GObject.registerClass(
  {
    GTypeName: "PanelWeather",
  },
  class PanelWeather extends St.BoxLayout {
    _init(weather, networkIcon) {
      super._init({
        visible: false,
      });

      this._weather = weather;
      this._networkIcon = networkIcon;

      this._signals = [];

      this._icon = new St.Icon({
        icon_size: 16,
      });

      this.add_child(this._icon);

      this._label = new St.Label({
        style_class: "clock-label",
      });
      this._label.clutter_text.y_align = Clutter.ActorAlign.CENTER;
      this._label.add_style_class_name("weather_label");

      this.add_child(this._label);

      this._pushSignal(
        this._weather,
        "changed",
        this._onWeatherInfoUpdate.bind(this),
      );

      this._pushSignal(this, "destroy", this._onDestroy.bind(this));

      if (this._networkIcon) {
        this._pushSignal(
          this._networkIcon,
          "notify::icon-name",
          this._onNetworkIconNotifyEvents.bind(this),
        );
        this._pushSignal(
          this._networkIcon,
          "notify::visible",
          this._onNetworkIconNotifyEvents.bind(this),
        );
        if (this._networkIcon.visible) {
          this._weather.update();
          this._StartLongTermUpdateTimeout();
        }
      } else {
        this._weather.update();
        this._StartLongTermUpdateTimeout();
      }
    }

    _pushSignal(obj, signalName, callback) {
      this._signals.push({
        obj: obj,
        signalId: obj.connect(signalName, callback),
      });
    }

    _onWeatherInfoUpdate(weather) {
      this._icon.icon_name = weather.info.get_symbolic_icon_name();
      // "--" is not a valid temp...
      this._label.text = weather.info.get_temp_summary().replace("--", "");
      this.visible = this._icon.icon_name && this._label.text;
    }

    _onNetworkIconNotifyEvents(networkIcon) {
      if (networkIcon.visible && !this.visible) {
        this._weather.update();
        this._StartLongTermUpdateTimeout();
      } else if (!networkIcon.visible) {
        this._canceLongTermUpdateTimeout();
        this.visible = false;
      }
    }

    _StartLongTermUpdateTimeout() {
      this._canceLongTermUpdateTimeout();
      this._weatherUpdateTimeout = GLib.timeout_add_seconds(
        GLib.PRIORITY_LOW,
        600,
        () => {
          this._weather.update();
          return GLib.SOURCE_CONTINUE;
        },
      );
    }

    _canceLongTermUpdateTimeout() {
      if (this._weatherUpdateTimeout) {
        GLib.source_remove(this._weatherUpdateTimeout);
      }
      this._weatherUpdateTimeout = null;
    }

    _onDestroy() {
      this._canceLongTermUpdateTimeout();
      this._signals.forEach((signal) => signal.obj.disconnect(signal.signalId));
      this._signals = null;
      this._weather = null;
      this._networkIcon = null;
    }
  },
);
