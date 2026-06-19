/*
 * Weather O'Clock extension for GNOME Shell 45+
 * Copyright 2022-2026 Cleo Menezes Jr.
 *
 * This software is released under the GNU General Public License v3 or later.
 * See <http://www.gnu.org/licenses/> for details.
 */

import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import St from "gi://St";
import GWeather from "gi://GWeather";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import { Spinner } from 'resource:///org/gnome/shell/ui/animation.js';

const STATES = Object.freeze({
  LOADING: 'LOADING',
  SHOWING: 'SHOWING',
  OFFLINE: 'OFFLINE',
  UNAVAILABLE: 'UNAVAILABLE',
  STALE: 'STALE',
});

const MAX_RETRIES = 5;

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
    const weather = dateMenu._weatherItem._weatherClient;
    this._originalClockDisplay = dateMenu._clockDisplay;
    this._settings = this.getSettings();
    this._panelWeather = new WeatherOClockPanelWeather(weather, this._originalClockDisplay);

    this._topBox = new St.BoxLayout({ style_class: "clock" });

    this._originalClockDisplay.remove_style_class_name("clock");
    this._originalClockDisplay
      .get_parent()
      .replace_child(this._originalClockDisplay, this._topBox);

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
    _init(weather, clockDisplay) {
      super._init({
        visible: false,
        y_align: Clutter.ActorAlign.CENTER,
      });

      this._weather = weather;
      this._clockDisplay = clockDisplay;
      this._signals = [];
      this._descriptionTimer = null;
      this._retryTimer = null;
      this._longTermUpdateTimer = null;
      this._retryCount = 0;
      this._notified = false;
      this._state = null;
      this._monitor = Gio.NetworkMonitor.get_default();
      this._currentDescription = null;
      this._currentTemp = null;
      this._currentIconName = null;
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
      this._pushSignal(this._weather, "notify::available", this._onAvailableChanged.bind(this));
      this._pushSignal(this._monitor, "notify::connectivity", this._onConnectivityChanged.bind(this));

      this._evaluateInitialState();
    }

    _pushSignal(obj, signalName, callback) {
      this._signals.push({ obj, signalId: obj.connect(signalName, callback) });
    }

    destroy() {
      this.remove_all_transitions();
      this._cancelAllTimers();
      this._spinner.stop();
      this._signals.forEach((s) => s.obj.disconnect(s.signalId));
      this._signals = null;
      this._weather = null;
      this._monitor = null;
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

    _fadeIn(actor, onShown) {
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
    }

    _applyTransition(actor, applyFn, onShown = null) {
      if (!this.visible || this.opacity === 0 || actor.opacity === 0) {
        const fromWidth = this.visible ? this.width : 0;
        applyFn();
        actor.opacity = 0;
        this.visible = true;
        this._animateLayoutTranslation(fromWidth);
        this._fadeIn(actor, onShown);
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
          this._fadeIn(actor, onShown);
        },
      });
    }

    _crossfade(applyFn, onShown = null) {
      this._applyTransition(this, applyFn, onShown);
    }

    _showWeather(iconName, temp, onShown = null) {
      const changed = iconName !== this._currentIconName || temp !== this._currentTemp;
      const wasShowing = this._state === STATES.SHOWING;
      this._currentTemp = temp;
      this._currentIconName = iconName;

      if (wasShowing && (!changed || this._showingDescription))
        return;

      this._applyTransition(wasShowing ? this._label : this, () => {
        this._spinner.stop();
        this._icon.icon_name = iconName;
        this._icon.show();
        if (!this._showingDescription) {
          this._label.text = temp;
          this._label.show();
        }
      }, onShown);

      this._setState(STATES.SHOWING);
    }

    _setState(newState) {
      if (this._state === newState) return;
      this._state = newState;

      switch (newState) {
        case STATES.LOADING:
          this._cancelDescriptionTimer();
          this._crossfade(() => {
            this._spinner.play();
            this._icon.hide();
            this._label.hide();
          });
          break;

        case STATES.SHOWING:
          this._startLongTermUpdateTimeout();
          break;

        case STATES.OFFLINE:
          this._cancelAllTimers();
          this._hideWidget();
          break;

        case STATES.STALE:
          this._cancelAllTimers();
          if (!this._currentIconName || !this._currentTemp)
            this._hideWidget();
          break;

        case STATES.UNAVAILABLE:
          this._cancelAllTimers();
          this._hideWidget();
          if (!this._notified) {
            this._notified = true;
            Main.notify(
              _('Weather O\'Clock'),
              _('GNOME Weather is required. Please install it for weather information to appear.'),
            );
          }
          break;
      }
    }

    _onConnectivityChanged() {
      if (!this._weather) return;
      if (this._state === STATES.UNAVAILABLE) return;

      const connectivity = this._monitor.connectivity;

      if (connectivity === Gio.NetworkConnectivity.LOCAL) {
        this._cancelRetryTimer();
        if (!this._weather.info.is_valid())
          this._setState(STATES.OFFLINE);
        return;
      }

      if (this._state === STATES.OFFLINE || this._state === STATES.STALE) {
        this._retryCount = 0;
        this._weather.update();
        this._setState(STATES.LOADING);
      }
    }

    _onAvailableChanged() {
      if (!this._weather) return;

      if (!this._weather.available) {
        this._setState(STATES.UNAVAILABLE);
        return;
      }

      if (this._state === STATES.UNAVAILABLE) {
        this._notified = false;
        this._state = STATES.OFFLINE;
        this._onConnectivityChanged();
      }
    }

    _evaluateInitialState() {
      if (!this._weather) return;

      // update() silently no-ops on fresh cached info, so forcing LOADING here would never resolve.
      if (this._weather.info.is_valid() || this._weather.loading) {
        this._onWeatherInfoUpdate(this._weather);
        return;
      }

      if (this._monitor.connectivity === Gio.NetworkConnectivity.LOCAL) {
        this._setState(STATES.OFFLINE);
        return;
      }
      this._weather.update();
      this._setState(STATES.LOADING);
    }

    _onWeatherInfoUpdate(weather) {
      if (!this._weather) return;
      if (this._state === STATES.UNAVAILABLE) return;

      if (weather.loading) {
        if (this._state !== STATES.SHOWING)
          this._setState(STATES.LOADING);
        return;
      }

      const iconName = weather.info.get_symbolic_icon_name();
      const [tempOk] = weather.info.get_value_temp(GWeather.TemperatureUnit.DEFAULT);
      const temp = tempOk ? weather.info.get_temp_summary() : "";

      if (iconName && iconName !== "weather-missing-symbolic" && temp) {
        this._cancelRetryTimer();
        this._retryCount = 0;

        const [skyOk, skyValue] = weather.info.get_value_sky();
        const [condOk, condPhenom] = weather.info.get_value_conditions();
        let description = null;

        if (skyOk && skyValue !== GWeather.Sky.INVALID)
          description = weather.info.get_sky();
        else if (condOk && condPhenom !== GWeather.ConditionPhenomenon.INVALID && condPhenom !== GWeather.ConditionPhenomenon.NONE)
          description = weather.info.get_conditions();

        const onShown = description ? () => {
          if (!this._weather) return;
          if (this._descriptionTimer) {
            GLib.source_remove(this._descriptionTimer);
            this._descriptionTimer = null;
          }
          this._descriptionTimer = GLib.timeout_add(GLib.PRIORITY_LOW, 1500, () => {
            this._descriptionTimer = null;
            if (!this._weather) return GLib.SOURCE_REMOVE;
            this._showDescription(description);
            return GLib.SOURCE_REMOVE;
          });
        } : null;

        this._showWeather(iconName, temp, onShown);
        return;
      }

      if (this._monitor.connectivity === Gio.NetworkConnectivity.LOCAL) {
        this._setState(STATES.OFFLINE);
      } else if (this._retryCount < MAX_RETRIES) {
        this._scheduleRetry();
      } else if (!weather.available) {
        this._setState(STATES.UNAVAILABLE);
      } else {
        this._setState(STATES.STALE);
      }
    }

    _cancelDescriptionTimer() {
      if (this._descriptionTimer) {
        GLib.source_remove(this._descriptionTimer);
        this._descriptionTimer = null;
      }
    }

    _cancelRetryTimer() {
      if (this._retryTimer) {
        GLib.source_remove(this._retryTimer);
        this._retryTimer = null;
      }
    }

    _cancelLongTermUpdateTimer() {
      if (this._longTermUpdateTimer) {
        GLib.source_remove(this._longTermUpdateTimer);
        this._longTermUpdateTimer = null;
      }
    }

    _cancelAllTimers() {
      this._cancelDescriptionTimer();
      this._cancelRetryTimer();
      this._cancelLongTermUpdateTimer();
    }

    _scheduleRetry() {
      if (this._retryTimer) return;
      this._retryCount++;
      const delay = this._retryCount <= 2 ? 5 : 30;
      this._retryTimer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, delay, () => {
        this._retryTimer = null;
        if (this._weather) this._weather.update();
        return GLib.SOURCE_REMOVE;
      });
    }

    _showDescription(text) {
      if (!text || text === "-" || text === this._currentDescription) return;
      this._currentDescription = text;

      this._cancelDescriptionTimer();
      this._showingDescription = true;

      this._applyTransition(this._label, () => {
        this._label.text = text;
      }, () => {
        if (!this._weather) return;
        if (this._descriptionTimer) {
          GLib.source_remove(this._descriptionTimer);
          this._descriptionTimer = null;
        }
        this._descriptionTimer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 5, () => {
          this._descriptionTimer = null;
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
      this._cancelLongTermUpdateTimer();
      this._longTermUpdateTimer = GLib.timeout_add_seconds(
        GLib.PRIORITY_LOW,
        600,
        () => {
          if (!this._weather) return GLib.SOURCE_REMOVE;
          if (this._monitor.connectivity === Gio.NetworkConnectivity.LOCAL)
            return GLib.SOURCE_CONTINUE;
          this._weather.update();
          return GLib.SOURCE_CONTINUE;
        },
      );
    }

  },
);
