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
import { Spinner } from 'resource:///org/gnome/shell/ui/animation.js';

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

    if (this._panelWeather) {
      this._panelWeather.destroy();
      this._panelWeather = null;
    }

    this._topBox.get_parent()?.replace_child(this._topBox, clockDisplay);
    this._topBox.destroy();
    this._topBox = null;
    this._originalClockDisplay = null;
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
        opacity: 0,
        y_align: Clutter.ActorAlign.CENTER,
      });

      this._weather = weather;
      this._networkIcon = networkIcon;
      this._signals = [];
      this._weatherUpdateTimeout = null;
      this._hasData = false;

      this._icon = new St.Icon({
        y_align: Clutter.ActorAlign.CENTER,
        style_class: "system-status-icon custom-weather-icon-spacing",
      });

      this._spinner = new Spinner(16, { animate: false, hideOnStop: true });
      this._spinner.y_align = Clutter.ActorAlign.CENTER;

      const iconStack = new St.Widget({
        y_align: Clutter.ActorAlign.CENTER,
        layout_manager: new Clutter.BinLayout(),
      });
      iconStack.add_child(this._icon);
      iconStack.add_child(this._spinner);
      this.add_child(iconStack);

      this._label = new St.Label({
        y_align: Clutter.ActorAlign.CENTER,
        style_class: "clock-label weather_label",
      });
      this._label.clutter_text.y_align = Clutter.ActorAlign.CENTER;
      this.add_child(this._label);

      this._pushSignal(this._weather, "changed", this._onWeatherInfoUpdate.bind(this));

      if (this._networkIcon) {
        this._pushSignal(this._networkIcon, "notify::icon-name", this._onNetworkIconNotifyEvents.bind(this));
        this._pushSignal(this._networkIcon, "notify::visible", this._onNetworkIconNotifyEvents.bind(this));
        if (this._networkIcon.visible) {
          this._weather.update();
          this._startLongTermUpdateTimeout();
        } else {
          this._showOffline();
        }
      } else {
        this._weather.update();
        this._startLongTermUpdateTimeout();
      }
    }

    _pushSignal(obj, signalName, callback) {
      this._signals.push({ obj, signalId: obj.connect(signalName, callback) });
    }

    destroy() {
      this.remove_all_transitions();
      this._cancelLongTermUpdateTimeout();
      this._spinner.stop();
      this._signals.forEach((s) => s.obj.disconnect(s.signalId));
      this._signals = null;
      this._weather = null;
      this._networkIcon = null;
      super.destroy();
    }

    _crossfade(applyFn) {
      const doTransition = () => {
        applyFn();
        this.ease({
          opacity: 255,
          duration: 500,
          mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
      };

      if (this.opacity === 0) {
        doTransition();
        return;
      }

      this.ease({
        opacity: 0,
        duration: 250,
        mode: Clutter.AnimationMode.EASE_IN_QUAD,
        onComplete: () => {
          if (!this._weather) return;
          doTransition();
        },
      });
    }

    _startSpinner() {
      this._crossfade(() => {
        this._spinner.play();
        this._icon.hide();
        this._label.hide();
      });
    }

    _showWeather(iconName, temp) {
      if (this._hasData) {
        this._icon.icon_name = iconName;
        this._label.text = temp;
        return;
      }
      this._crossfade(() => {
        this._spinner.stop();
        this._icon.icon_name = iconName;
        this._icon.show();
        this._label.text = temp;
        this._label.show();
      });
    }

    _showOffline() {
      this._crossfade(() => {
        this._spinner.stop();
        this._icon.icon_name = "network-offline-symbolic";
        this._icon.show();
        this._label.hide();
      });
    }

    _onWeatherInfoUpdate(weather) {
      if (!this._weather) return;

      if (weather.loading) {
        if (!this._hasData)
          this._startSpinner();
        return;
      }

      const iconName = weather.info.get_symbolic_icon_name();
      // "--" is not a valid temp...
      const temp = weather.info.get_temp_summary().replace("--", "");

      if (iconName && temp) {
        this._showWeather(iconName, temp);
        this._hasData = true;
      } else if (!this._hasData) {
        this.ease({ opacity: 0, duration: 250, mode: Clutter.AnimationMode.EASE_IN_QUAD });
      }
    }

    _onNetworkIconNotifyEvents(networkIcon) {
      if (networkIcon.visible) {
        this._weather.update();
        this._startLongTermUpdateTimeout();
      } else {
        this._cancelLongTermUpdateTimeout();
        if (!this._hasData)
          this._showOffline();
      }
    }

    _startLongTermUpdateTimeout() {
      this._cancelLongTermUpdateTimeout();
      this._weatherUpdateTimeout = GLib.timeout_add_seconds(
        GLib.PRIORITY_LOW,
        600,
        () => {
          this._weather.update();
          return GLib.SOURCE_CONTINUE;
        },
      );
    }

    _cancelLongTermUpdateTimeout() {
      if (this._weatherUpdateTimeout) {
        GLib.source_remove(this._weatherUpdateTimeout);
        this._weatherUpdateTimeout = null;
      }
    }

  },
);
