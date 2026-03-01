/*
 * Weather O'Clock extension for GNOME Shell 45+
 * Copyright 2022-2026 Cleo Menezes Jr., 2020 Jason Gray (JasonLG1979)
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
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class WeatherOClock extends Extension {
  constructor(metadata) {
    super(metadata);

    this._topBox = null;
    this._originalClockDisplay = null;
    this._panelWeather = null;
    this._positionChangeListener = null;
    this._settings = null;
  }

  enable() {
    const dateMenu = Main.panel.statusArea.dateMenu;
    const network = Main.panel._network;
    const networkIcon = network ? network._primaryIndicator : null;
    const weather = new Weather.WeatherClient();

    // Snapshot the original widget so disable() can restore it faithfully.
    this._originalClockDisplay = dateMenu._clockDisplay;
    this._panelWeather = new PanelWeather(weather, networkIcon);

    this._topBox = new St.BoxLayout({ style_class: "clock" });

    this._originalClockDisplay.remove_style_class_name("clock");
    this._originalClockDisplay
      .get_parent()
      .replace_child(this._originalClockDisplay, this._topBox);

    this._settings = this.getSettings();
    this._positionChangeListener = this._settings.connect(
      "changed::weather-after-clock",
      () => this._addWidget(),
    );
    this._addWidget();
  }

  disable() {
    if (this._positionChangeListener) {
      this._settings.disconnect(this._positionChangeListener);
      this._positionChangeListener = null;
    }
    this._settings = null;

    const clockDisplay = this._originalClockDisplay;
    clockDisplay.remove_style_class_name("label-right-margin");
    clockDisplay.remove_style_class_name("label-left-margin");
    clockDisplay.add_style_class_name("clock");

    if (clockDisplay.get_parent() === this._topBox)
      this._topBox.remove_child(clockDisplay);

    this._topBox.get_parent()?.replace_child(this._topBox, clockDisplay);

    this._topBox.destroy();
    this._topBox = null;
    this._originalClockDisplay = null;

    if (this._panelWeather) {
      this._panelWeather.destroy();
      this._panelWeather = null;
    }
  }

  _addWidget() {
    const clockDisplay = this._originalClockDisplay;

    if (clockDisplay.get_parent() === this._topBox)
      this._topBox.remove_child(clockDisplay);
    if (this._panelWeather.get_parent() === this._topBox)
      this._topBox.remove_child(this._panelWeather);

    clockDisplay.remove_style_class_name("label-right-margin");
    clockDisplay.remove_style_class_name("label-left-margin");

    const isWeatherAfterClock = this._settings.get_boolean("weather-after-clock");
    if (isWeatherAfterClock) {
      this._topBox.add_child(clockDisplay);
      this._topBox.add_child(this._panelWeather);
      clockDisplay.add_style_class_name("label-right-margin");
    } else {
      this._topBox.add_child(this._panelWeather);
      this._topBox.add_child(clockDisplay);
      clockDisplay.add_style_class_name("label-left-margin");
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
        y_align: Clutter.ActorAlign.CENTER,
      });

      this._weather = weather;
      this._networkIcon = networkIcon;

      this._signals = [];

      this._icon = new St.Icon({
        y_align: Clutter.ActorAlign.CENTER,
        style_class: "system-status-icon custom-weather-icon-spacing",
      });

      this.add_child(this._icon);

      this._label = new St.Label({
        y_align: Clutter.ActorAlign.CENTER,
        style_class: "clock-label weather_label",
      });
      this._label.clutter_text.y_align = Clutter.ActorAlign.CENTER;

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
      if (!weather.loading) {
        this._icon.icon_name = weather.info.get_symbolic_icon_name();
        // "--" is not a valid temp...
        this._label.text = weather.info.get_temp_summary().replace("--", "");
        this.visible = this._icon.icon_name && this._label.text;
      }
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
