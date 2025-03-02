/*
 * Weather O'Clock extension for GNOME Shell 45+
 * Copyright 2022-2024 Cleo Menezes Jr., 2020 Jason Gray (JasonLG1979)
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

let panelWeather = null;
let statusArea, dateMenu, weather, network, networkIcon, isWeatherAfterClock;

export default class weatherOClock  extends Extension {
  constructor(metadata) {
    super(metadata);

    this._topBox = null;
    this._positionChangeListener = null;
    this._settings = null;
  }

  enable() {
    if (panelWeather) return

    statusArea = Main.panel.statusArea;
    dateMenu = statusArea.dateMenu;
    weather = new Weather.WeatherClient();
    network = Main.panel._network;
    networkIcon = network ? network._primaryIndicator : null;
    panelWeather = new PanelWeather(weather, networkIcon);

    this._topBox = new St.BoxLayout({
      style_class: "clock",
    });

    dateMenu._clockDisplay.remove_style_class_name("clock");
    dateMenu._clockDisplay
      .get_parent()
      .replace_child(dateMenu._clockDisplay, this._topBox);


    this._settings = this.getSettings();
    this._positionChangeListener = this._settings.connect('changed::weather-after-clock', () => this._addWidget());
    this._addWidget();
  }

  disable() {
    this._positionChangeListener = null
    this._topBox.remove_child(dateMenu._clockDisplay);
    dateMenu._clockDisplay.remove_style_class_name("label-right-margin");
    dateMenu._clockDisplay.remove_style_class_name("label-left-margin");

    this._topBox
      .get_parent()
      .replace_child(this._topBox, dateMenu._clockDisplay);

    this._topBox = null;
    weather = null;
    if (panelWeather) {
      panelWeather.destroy();
      panelWeather = null;
    }
  }

  _addWidget() {
    this._topBox.remove_child(dateMenu._clockDisplay);
    this._topBox.remove_child(panelWeather);
    dateMenu._clockDisplay.remove_style_class_name("label-right-margin");
    dateMenu._clockDisplay.remove_style_class_name("label-left-margin");

    isWeatherAfterClock = this._settings.get_boolean('weather-after-clock');
    if (isWeatherAfterClock) {
      this._topBox.add_child(dateMenu._clockDisplay);
      this._topBox.add_child(panelWeather);
      dateMenu._clockDisplay.add_style_class_name("label-right-margin");

      return
    }

    this._topBox.add_child(panelWeather);
    this._topBox.add_child(dateMenu._clockDisplay);
    dateMenu._clockDisplay.add_style_class_name("label-left-margin");
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
        this._label.text = weather.info.get_temp_summary().replace("--", "").replace(" ", "");
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
