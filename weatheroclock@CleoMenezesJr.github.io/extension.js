/*
 * Weather O'Clock extension for GNOME Shell 45+
 * Copyright 2022-2026 Cleo Menezes Jr., 2020 Jason Gray (JasonLG1979)
 *
 * This software is released under the GNU General Public License v3 or later.
 * See <http://www.gnu.org/licenses/> for details.
 */

import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import St from "gi://St";
import GWeather from "gi://GWeather";

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
    const weather = dateMenu._weatherItem._weatherClient;
    this._originalClockDisplay = dateMenu._clockDisplay;
    this._panelWeather = new WeatherOClockPanelWeather(weather, networkIcon, this._originalClockDisplay);

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
    clockDisplay.remove_all_transitions();
    clockDisplay.translation_x = 0;
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

    this._panelWeather.remove_style_class_name("weather-before-clock");
    this._panelWeather.remove_style_class_name("weather-after-clock");

    const isWeatherAfterClock = this._settings.get_boolean("weather-after-clock");
    if (isWeatherAfterClock) {
      this._topBox.add_child(clockDisplay);
      this._topBox.add_child(this._panelWeather);
      this._panelWeather.add_style_class_name("weather-after-clock");
    } else {
      this._topBox.add_child(this._panelWeather);
      this._topBox.add_child(clockDisplay);
      this._panelWeather.add_style_class_name("weather-before-clock");
    }
  }
}

const WeatherOClockPanelWeather = GObject.registerClass(
  {
    GTypeName: "WeatherOClockPanelWeather",
  },
  class WeatherOClockPanelWeather extends St.BoxLayout {
    _init(weather, networkIcon, clockDisplay) {
      super._init({
        visible: false,
        y_align: Clutter.ActorAlign.CENTER,
      });

      this._weather = weather;
      this._networkIcon = networkIcon;
      this._clockDisplay = clockDisplay;
      this._signals = [];
      this._weatherUpdateTimeout = null;
      this._retryTimeout = null;
      this._descriptionTimeout = null;
      this._retryCount = 0;
      this._hasData = false;
      this._notified = false;
      this._gaveUp = false;
      this._currentDescription = null;
      this._currentTemp = null;
      this._showingDescription = false;

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
        if (this._networkIcon.visible)
          this._weather.update();
        else
          this._showOffline();
      } else {
        this._weather.update();
      }
    }

    _pushSignal(obj, signalName, callback) {
      this._signals.push({ obj, signalId: obj.connect(signalName, callback) });
    }

    destroy() {
      this.remove_all_transitions();
      this._cancelLongTermUpdateTimeout();
      this._cancelRetry();
      this._cancelDescriptionTimeout();
      this._spinner.stop();
      this._signals.forEach((s) => s.obj.disconnect(s.signalId));
      this._signals = null;
      this._weather = null;
      this._networkIcon = null;
      this._clockDisplay = null;
      super.destroy();
    }

    _animateLayoutTranslation(fromWidth) {
      const parent = this.get_parent();
      const clockDisplay = this._clockDisplay;
      if (!parent || !clockDisplay) return;

      const [, toWidth] = this.get_preferred_width(-1);
      const delta = toWidth - fromWidth;
      if (Math.abs(delta) <= 2) return;

      const children = parent.get_children();
      const myIndex = children.indexOf(this);
      const clockIndex = children.indexOf(clockDisplay);
      const sign = myIndex < clockIndex ? -1 : 1;

      // Animate Clock
      clockDisplay.remove_all_transitions();
      clockDisplay.translation_x = sign * delta / 2;
      clockDisplay.ease({
        translation_x: 0,
        duration: 500,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      });

      // Animate Weather
      this.remove_all_transitions();
      this.translation_x = -sign * delta / 2;
      this.ease({
        translation_x: 0,
        duration: 500,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      });
    }

    _applyTransition(actor, applyFn, onShown = null) {
      if (!this.visible || this.opacity === 0 || actor.opacity === 0) {
        const fromWidth = this.visible ? this.width : 0;
        applyFn();
        actor.opacity = 0;
        this.visible = true;
        this._animateLayoutTranslation(fromWidth);
        actor.ease({
          opacity: 255,
          duration: 500,
          delay: 150,
          mode: Clutter.AnimationMode.EASE_OUT_QUAD,
          onComplete: () => {
            if (this._weather)
              onShown?.();
          },
        });
        return;
      }

      actor.ease({
        opacity: 0,
        duration: 250,
        mode: Clutter.AnimationMode.EASE_IN_QUAD,
        onComplete: () => {
          if (!this._weather) return;
          const fromWidth = this.width;
          applyFn();
          this._animateLayoutTranslation(fromWidth);
          actor.ease({
            opacity: 255,
            duration: 500,
            delay: 150,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
              if (this._weather)
                onShown?.();
            },
          });
        },
      });
    }

    _crossfade(applyFn, onShown = null) {
      this._applyTransition(this, applyFn, onShown);
    }

    _startSpinner() {
      this._crossfade(() => {
        this._spinner.play();
        this._icon.hide();
        this._label.hide();
      });
    }

    _showWeather(iconName, temp, onShown = null) {
      this._currentTemp = temp;
      this._applyTransition(this._hasData ? this._label : this, () => {
        this._spinner.stop();
        this._icon.icon_name = iconName;
        this._icon.show();
        if (!this._showingDescription) {
          this._label.text = temp;
          this._label.show();
        }
      }, onShown);

      if (!this._hasData) {
        this._hasData = true;
        this._startLongTermUpdateTimeout();
      }
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
        if (!this._hasData && !this._gaveUp) {
          this._startSpinner();
          this._scheduleRetry();
        }
        return;
      }

      const iconName = weather.info.get_symbolic_icon_name();
      const [tempOk] = weather.info.get_value_temp(GWeather.TemperatureUnit.DEFAULT);
      const temp = tempOk ? weather.info.get_temp_summary() : "";

      if (iconName && iconName !== "weather-missing-symbolic" && temp) {
        this._cancelRetry();
        this._retryCount = 0;
        this._gaveUp = false;
        const [skyOk, skyValue] = weather.info.get_value_sky();
        const [condOk, condPhenom, condQual] = weather.info.get_value_conditions();
        let description = null;

        if (skyOk && skyValue !== GWeather.Sky.INVALID)
          description = weather.info.get_sky();
        else if (condOk && condPhenom !== GWeather.ConditionPhenomenon.INVALID && condPhenom !== GWeather.ConditionPhenomenon.NONE)
          description = weather.info.get_conditions();

        const onShown = description ? () => {
          if (!this._weather) return;
          this._cancelDescriptionTimeout();
          this._descriptionTimeout = GLib.timeout_add(GLib.PRIORITY_LOW, 1500, () => {
            this._descriptionTimeout = null;
            if (this._weather) this._showDescription(description);
            return GLib.SOURCE_REMOVE;
          });
        } : null;
        this._showWeather(iconName, temp, onShown);
      } else if (!this._hasData) {
        if (this._networkIcon && !this._networkIcon.visible) return;
        if (this._retryCount < 5) {
          this._scheduleRetry();
        } else {
          this._gaveUp = true;
          this._hideWidget();
          if (!weather.info.is_valid() && !this._notified) {
            this._notified = true;
            Main.notify(
              'Weather O\'Clock',
              'GNOME Weather is required. Please install it for weather information to appear.',
            );
          }
        }
      }
    }

    _onNetworkIconNotifyEvents(networkIcon) {
      if (networkIcon.visible) {
        this._retryCount = 0;
        this._gaveUp = false;
        this._weather.update();
        if (this._hasData)
          this._startLongTermUpdateTimeout();
      } else {
        this._cancelLongTermUpdateTimeout();
        this._cancelRetry();
        if (!this._hasData && !this._gaveUp)
          this._showOffline();
      }
    }

    _scheduleRetry() {
      if (this._retryTimeout) return;
      this._retryCount++;
      const delay = this._retryCount <= 2 ? 5 : 30;
      this._retryTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, delay, () => {
        this._retryTimeout = null;
        if (this._weather) this._weather.update();
        return GLib.SOURCE_REMOVE;
      });
    }

    _cancelRetry() {
      if (this._retryTimeout) {
        GLib.source_remove(this._retryTimeout);
        this._retryTimeout = null;
      }
    }

    _showDescription(text) {
      if (!text || text === "-" || text === this._currentDescription) return;
      this._currentDescription = text;

      this._cancelDescriptionTimeout();
      this._showingDescription = true;

      this._applyTransition(this._label, () => {
        this._label.text = text;
      }, () => {
        if (!this._weather) return;
        this._descriptionTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 5, () => {
          this._descriptionTimeout = null;
          if (this._weather) this._hideDescription();
          return GLib.SOURCE_REMOVE;
        });
      });
    }

    _hideDescription() {
      this._applyTransition(this._label, () => {
        this._showingDescription = false;
        this._label.text = this._currentTemp ?? "";
      });
    }

    _cancelDescriptionTimeout() {
      if (this._descriptionTimeout) {
        GLib.source_remove(this._descriptionTimeout);
        this._descriptionTimeout = null;
      }
    }

    _hideWidget() {
      if (!this.visible) return;
      this._spinner.stop();
      this.remove_all_transitions();
      this.ease({
        opacity: 0,
        duration: 250,
        mode: Clutter.AnimationMode.EASE_IN_QUAD,
        onComplete: () => { this.visible = false; },
      });
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
