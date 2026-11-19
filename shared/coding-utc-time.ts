/** UTC for learner code, wherever it runs (owner decision, 9 October 2026,
 * afternoon, which replaced the morning's Europe/Prague).
 *
 * Submit grades in QuickJS, whose local time followed the server's zone,
 * while Run used the learner's own zone, so code that read local hours could
 * pass on one and fail on the other. Every runner now gives learner code the
 * same local time, UTC, with no summer time: the local getters read what the
 * UTC getters read, `getTimezoneOffset()` is 0 all year and `toString` ends in
 * "GMT+0000 (Coordinated Universal Time)". The server's own process keeps
 * UTC: only the `Date` learner code sees changes.
 *
 * The rule is written once, here, as source text, because QuickJS needs text
 * to evaluate inside the VM and the browser runners compile the same text, so
 * Run and Submit read the same hour for the same instant whatever the
 * learner's or the server's zone. It is a function of the realm's own `Date`
 * and returns the `Date` learner code should see:
 *
 *  - `inPlace: true` (QuickJS, the Run worker, the React frame and page
 *    realm, each of which exists only for learner code) also rewrites the
 *    local-time methods on the realm's `Date.prototype`, so every date in the
 *    realm reads UTC. Without it, the returned constructor has a prototype of
 *    its own and the realm's built-ins are left alone.
 *  - `clock` replaces `Date.now` (the grader's timers are virtual).
 *  - `intl`, the realm's `Intl` where it has one (the React runners), makes
 *    `toLocale*String` and `Intl.DateTimeFormat` default to UTC; a zone the
 *    code names is used as named. Without it (QuickJS has no `Intl`, and Run
 *    hides it to match), the `toLocale*String` methods format en-US text
 *    themselves, in UTC or in a named UTC or Europe/Prague zone.
 *
 * What it covers: the constructor's local forms (`new Date(y, m, ...)`),
 * `Date()` and `Date.parse` of a local date-time string, every local `get*`
 * and `set*` method, `getTimezoneOffset`, `toString`, `toDateString`,
 * `toTimeString` and the `toLocale*String` methods. UTC methods, `getTime`,
 * `toISOString` and `toJSON` are unchanged. Plain ES2019, so every browser the
 * app supports and QuickJS evaluate it as written. */

const LEARNER_TIME_ZONE = 'UTC';

export interface UtcTimeOptions {
  inPlace?: boolean;
  clock?: () => number;
  intl?: unknown;
}

export const UTC_TIME_SOURCE = String.raw`(NativeDate, settings) => {
  'use strict';
  const options = settings || {};
  const apply = Reflect.apply, construct = Reflect.construct, defineProperty = Object.defineProperty;
  const floor = Math.floor, trunc = Math.trunc, abs = Math.abs, isFiniteNumber = Number.isFinite;
  const NativeString = String, NativeObject = Object, NativeTypeError = TypeError, NativeRangeError = RangeError;
  const proto = NativeDate.prototype;
  const getTime = proto.getTime, setTime = proto.setTime;
  const nativeParse = NativeDate.parse, nativeNow = NativeDate.now, nativeUTC = NativeDate.UTC;
  const nativeLocal = [proto.getFullYear, proto.getMonth, proto.getDate, proto.getHours, proto.getMinutes, proto.getSeconds, proto.getMilliseconds];
  const nativeLocale = { toLocaleString: proto.toLocaleString, toLocaleDateString: proto.toLocaleDateString, toLocaleTimeString: proto.toLocaleTimeString };
  const clock = typeof options.clock === 'function' ? options.clock : () => apply(nativeNow, NativeDate, []);
  const SECOND = 1000, MINUTE = 60000, HOUR = 3600000, DAY = 86400000;
  const timeClip = (t) => (isFiniteNumber(t) && abs(t) <= 8.64e15 ? trunc(t) + 0 : NaN);
  const timeOf = (date) => apply(getTime, date, []);

  // Day numbers and civil dates in the proleptic Gregorian calendar (day 0 is
  // 1 January 1970), with whole-number arithmetic, so no host Date is asked.
  const daysFromCivil = (year, month, day) => {
    const y = month <= 2 ? year - 1 : year;
    const era = floor(y / 400);
    const yoe = y - era * 400;
    const doy = floor((153 * (month > 2 ? month - 3 : month + 9) + 2) / 5) + day - 1;
    return era * 146097 + yoe * 365 + floor(yoe / 4) - floor(yoe / 100) + doy - 719468;
  };
  const civilFromDays = (days) => {
    const z = days + 719468;
    const era = floor(z / 146097);
    const doe = z - era * 146097;
    const yoe = floor((doe - floor(doe / 1460) + floor(doe / 36524) - floor(doe / 146096)) / 365);
    const doy = doe - (365 * yoe + floor(yoe / 4) - floor(yoe / 100));
    const mp = floor((5 * doy + 2) / 153);
    const month = mp < 10 ? mp + 3 : mp - 9;
    return [yoe + era * 400 + (month <= 2 ? 1 : 0), month - 1, doy - floor((153 * mp + 2) / 5) + 1];
  };
  const weekdayOf = (days) => (((days + 4) % 7) + 7) % 7;
  const lastSunday = (year, month) => {
    const last = daysFromCivil(year, month + 1, 1) - 1;
    return last - weekdayOf(last);
  };

  // Minutes east of UTC in Europe/Prague, for the toLocale*String methods
  // when the code names that zone: summer time from 01:00 UTC on the last
  // Sunday of March until 01:00 UTC on the last Sunday of October (the EU
  // rule, applied to every year). Local time itself is UTC.
  let cachedYear = NaN, summerFrom = 0, summerUntil = 0;
  const pragueOffsetAt = (t) => {
    const year = civilFromDays(floor(t / DAY))[0];
    if (year !== cachedYear) {
      cachedYear = year;
      summerFrom = lastSunday(year, 3) * DAY + HOUR;
      summerUntil = lastSunday(year, 10) * DAY + HOUR;
    }
    return t >= summerFrom && t < summerUntil ? 120 : 60;
  };
  // [year, month, date, hours, minutes, seconds, ms, weekday] of a wall-clock time.
  const fieldsOf = (local) => {
    const days = floor(local / DAY);
    const time = local - days * DAY;
    const ymd = civilFromDays(days);
    return [ymd[0], ymd[1], ymd[2], floor(time / HOUR), floor(time / MINUTE) % 60, floor(time / SECOND) % 60, time % SECOND, weekdayOf(days)];
  };
  // MakeDate(MakeDay(...), MakeTime(...)) as the language defines them.
  const makeTime = (year, month, date, hours, minutes, seconds, ms) => {
    if (!(isFiniteNumber(year) && isFiniteNumber(month) && isFiniteNumber(date) && isFiniteNumber(hours) && isFiniteNumber(minutes) && isFiniteNumber(seconds) && isFiniteNumber(ms))) return NaN;
    const m = trunc(month);
    const days = daysFromCivil(trunc(year) + floor(m / 12), (((m % 12) + 12) % 12) + 1, 1) + trunc(date) - 1;
    return days * DAY + trunc(hours) * HOUR + trunc(minutes) * MINUTE + trunc(seconds) * SECOND + trunc(ms);
  };

  // Date.parse. The ISO forms are read here, the way V8 reads them: a date
  // alone is UTC, a date and time with no offset is local, which is UTC too.
  // Anything else goes to the engine's own parser; when that text names no
  // zone, the engine read it in its own local time, so its wall-clock fields
  // are read again as UTC.
  const ISO = /^([+-]\d{6}|\d{4})(?:-(\d\d)(?:-(\d\d))?)?(?:[Tt ](\d\d):(\d\d)(?::(\d\d)(?:\.(\d+))?)?)?([Zz]|[+-]\d\d:?\d\d)?$/;
  const NAMED_ZONE = /\d\s*[Zz]\b|\b(?:UTC|GMT|UT|[ECMP][SD]T)\b|\d\s*[+-]\d\d:?\d\d\b/;
  const parseText = (text) => {
    const iso = ISO.exec(text);
    if (iso && iso[1] !== '-000000') {
      const month = iso[2] === undefined ? 1 : +iso[2];
      const day = iso[3] === undefined ? 1 : +iso[3];
      const timed = iso[4] !== undefined;
      const hour = timed ? +iso[4] : 0, minute = timed ? +iso[5] : 0, second = iso[6] === undefined ? 0 : +iso[6];
      const ms = iso[7] === undefined ? 0 : +(iso[7] + '00').slice(0, 3);
      if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 24 || minute > 59 || second > 59 || (hour === 24 && (minute || second || ms))) return NaN;
      const wall = makeTime(+iso[1], month - 1, day, hour, minute, second, ms);
      const zone = iso[8];
      if (zone === undefined || zone === 'Z' || zone === 'z') return timeClip(wall);
      if (!timed) return NaN;
      const digits = zone.replace(':', '');
      const hours = +digits.slice(1, 3), minutes = +digits.slice(3, 5);
      if (hours > 23 || minutes > 59) return NaN;
      return timeClip(wall - (zone[0] === '-' ? -1 : 1) * (hours * HOUR + minutes * MINUTE));
    }
    const t = apply(nativeParse, NativeDate, [text]);
    if (t !== t || NAMED_ZONE.test(text)) return t;
    const engine = construct(NativeDate, [t]);
    const f = [];
    for (let i = 0; i < 7; i++) f[i] = apply(nativeLocal[i], engine, []);
    return timeClip(makeTime(f[0], f[1], f[2], f[3], f[4], f[5], f[6]));
  };

  // ToPrimitive with no hint, for new Date(value).
  const toPrimitive = (value) => {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
    const exotic = value[Symbol.toPrimitive];
    if (exotic !== undefined && exotic !== null) {
      const result = apply(exotic, value, ['default']);
      if (result === null || (typeof result !== 'object' && typeof result !== 'function')) return result;
    } else {
      const names = ['valueOf', 'toString'];
      for (let i = 0; i < 2; i++) {
        const method = value[names[i]];
        if (typeof method !== 'function') continue;
        const result = apply(method, value, []);
        if (result === null || (typeof result !== 'object' && typeof result !== 'function')) return result;
      }
    }
    throw new NativeTypeError('Cannot convert object to primitive value');
  };
  const isDate = (value) => {
    if (value === null || typeof value !== 'object') return false;
    try { timeOf(value); return true; } catch (error) { return false; }
  };

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const pad = (value, width) => {
    let text = NativeString(value);
    while (text.length < width) text = '0' + text;
    return text;
  };
  const yearText = (year) => (year >= 0 ? pad(year, 4) : '-' + pad(-year, 4));
  const dateText = (f) => DAYS[f[7]] + ' ' + MONTHS[f[1]] + ' ' + pad(f[2], 2) + ' ' + yearText(f[0]);
  const timeText = (f) => pad(f[3], 2) + ':' + pad(f[4], 2) + ':' + pad(f[5], 2) + ' GMT+0000 (Coordinated Universal Time)';
  const stringOf = (t) => {
    if (t !== t) return 'Invalid Date';
    const f = fieldsOf(t);
    return dateText(f) + ' ' + timeText(f);
  };

  // toLocale*String without Intl: the en-US text the browser prints, for the
  // options learners reach for. The locale argument is not read: en-US is the
  // only locale here, as in an engine built without other locale data.
  const UTC_ZONES = { 'utc': 1, 'etc/utc': 1, 'gmt': 1, 'etc/gmt': 1, 'uct': 1, 'etc/uct': 1, 'universal': 1, 'etc/universal': 1, 'zulu': 1, 'etc/zulu': 1 };
  const pick = (from, name, allowed) => {
    const value = from[name];
    if (value === undefined) return undefined;
    const text = NativeString(value);
    if (allowed.indexOf(text) < 0) throw new NativeRangeError('Value ' + text + ' out of range for Intl.DateTimeFormat options property ' + name);
    return text;
  };
  const NUMERIC = ['numeric', '2-digit'];
  const TEXT = ['narrow', 'short', 'long'];
  const STYLES = ['full', 'long', 'medium', 'short'];
  const formatLocale = (date, given, required, defaults) => {
    const t = timeOf(date);
    if (given === null) throw new NativeTypeError('Cannot convert undefined or null to object');
    const o = given === undefined ? {} : NativeObject(given);
    let prague = false;
    if (o.timeZone !== undefined) {
      const zone = NativeString(o.timeZone);
      if (zone.toLowerCase() === 'europe/prague') prague = true;
      else if (UTC_ZONES[zone.toLowerCase()] !== 1) throw new NativeRangeError('Only the Europe/Prague and UTC time zones are available in the checker, not ' + zone + '.');
    }
    const hour12 = o.hour12;
    const hourCycle = pick(o, 'hourCycle', ['h11', 'h12', 'h23', 'h24']);
    let weekday = pick(o, 'weekday', TEXT);
    pick(o, 'era', TEXT);
    let year = pick(o, 'year', NUMERIC);
    let month = pick(o, 'month', NUMERIC.concat(TEXT));
    let day = pick(o, 'day', NUMERIC);
    const dayPeriod = pick(o, 'dayPeriod', TEXT);
    let hour = pick(o, 'hour', NUMERIC);
    let minute = pick(o, 'minute', NUMERIC);
    let second = pick(o, 'second', NUMERIC);
    const fractional = o.fractionalSecondDigits === undefined ? 0 : +o.fractionalSecondDigits;
    if (!(fractional >= 0 && fractional <= 3)) throw new NativeRangeError('fractionalSecondDigits value is out of range.');
    let zoneStyle = pick(o, 'timeZoneName', ['short', 'long', 'shortOffset', 'longOffset', 'shortGeneric', 'longGeneric']);
    const dateStyle = pick(o, 'dateStyle', STYLES);
    const timeStyle = pick(o, 'timeStyle', STYLES);
    if (dateStyle !== undefined || timeStyle !== undefined) {
      if (weekday || year || month || day || dayPeriod || hour || minute || second || fractional || zoneStyle) {
        throw new NativeTypeError('Can\'t set option ' + (weekday ? 'weekday' : year ? 'year' : month ? 'month' : day ? 'day' : hour ? 'hour' : minute ? 'minute' : second ? 'second' : 'timeZoneName') + ' when ' + (dateStyle !== undefined ? 'dateStyle' : 'timeStyle') + ' is used');
      }
      if (required === 'date' && timeStyle !== undefined) throw new NativeTypeError('Invalid option : timeStyle');
      if (required === 'time' && dateStyle !== undefined) throw new NativeTypeError('Invalid option : dateStyle');
      if (dateStyle === 'full') weekday = 'long';
      if (dateStyle === 'full' || dateStyle === 'long') month = 'long';
      if (dateStyle === 'medium') month = 'short';
      if (dateStyle === 'short') month = 'numeric';
      if (dateStyle !== undefined) { day = 'numeric'; year = dateStyle === 'short' ? '2-digit' : 'numeric'; }
      if (timeStyle !== undefined) {
        hour = 'numeric';
        minute = '2-digit';
        if (timeStyle !== 'short') second = '2-digit';
        if (timeStyle === 'full') zoneStyle = 'long';
        if (timeStyle === 'long') zoneStyle = 'short';
      }
    } else {
      const hasDate = required !== 'time' && (weekday || year || month || day);
      const hasTime = required !== 'date' && (dayPeriod || hour || minute || second || fractional);
      if (!hasDate && !hasTime) {
        if (defaults !== 'time') year = month = day = 'numeric';
        if (defaults !== 'date') hour = minute = second = 'numeric';
      }
    }
    if (t !== t) return 'Invalid Date';
    const offset = prague ? pragueOffsetAt(t) : 0;
    const f = fieldsOf(t + offset * MINUTE);
    const twelve = hour12 !== undefined ? !!hour12 : hourCycle !== undefined ? hourCycle === 'h11' || hourCycle === 'h12' : true;

    let datePart = '';
    const yearPart = year === '2-digit' ? pad((((f[0] % 100) + 100) % 100), 2) : NativeString(f[0]);
    const dayPart = day === '2-digit' ? pad(f[2], 2) : NativeString(f[2]);
    const weekdayPart = weekday === 'long' ? LONG_DAYS[f[7]] : weekday === 'short' ? DAYS[f[7]] : weekday === 'narrow' ? DAYS[f[7]][0] : '';
    const textMonth = month === 'long' || month === 'short' || month === 'narrow';
    if (textMonth) {
      datePart = month === 'long' ? LONG_MONTHS[f[1]] : month === 'short' ? MONTHS[f[1]] : MONTHS[f[1]][0];
      if (day) datePart += ' ' + dayPart;
      if (year) datePart += (day ? ', ' : ' ') + yearPart;
    } else {
      const pieces = [];
      if (month) pieces.push(month === '2-digit' ? pad(f[1] + 1, 2) : NativeString(f[1] + 1));
      if (day) pieces.push(dayPart);
      if (year) pieces.push(yearPart);
      datePart = pieces.join('/');
    }
    if (weekdayPart) datePart = datePart ? weekdayPart + ', ' + datePart : weekdayPart;

    let timePart = '';
    if (hour || minute || second) {
      const pieces = [];
      if (hour) {
        const h = twelve ? (f[3] % 12 === 0 ? 12 : f[3] % 12) : f[3];
        pieces.push(!twelve || hour === '2-digit' ? pad(h, 2) : NativeString(h));
      }
      if (minute) pieces.push(hour || second ? pad(f[4], 2) : NativeString(f[4]));
      if (second) pieces.push(hour || minute ? pad(f[5], 2) : NativeString(f[5]));
      timePart = pieces.join(':');
      if (fractional) timePart += '.' + pad(f[6], 3).slice(0, fractional);
      if (hour && twelve) timePart += f[3] < 12 ? ' AM' : ' PM';
    }
    if (zoneStyle) {
      const sign = 'GMT+' + offset / 60;
      const longSign = 'GMT+0' + offset / 60 + ':00';
      const zone = !prague
        ? (zoneStyle === 'long' ? 'Coordinated Universal Time' : zoneStyle === 'short' ? 'UTC' : zoneStyle === 'longOffset' || zoneStyle === 'longGeneric' ? longSign : sign)
        : zoneStyle === 'long' ? 'Central European ' + (offset === 120 ? 'Summer' : 'Standard') + ' Time'
          : zoneStyle === 'longOffset' ? longSign
            : zoneStyle === 'longGeneric' ? 'Central European Time'
              : zoneStyle === 'shortGeneric' ? 'Czechia Time' : sign;
      if (timePart) timePart += ' ' + zone;
      else datePart += (datePart ? ', ' : '') + zone;
    }
    if (!datePart) return timePart;
    if (!timePart) return datePart;
    const longGlue = dateStyle !== undefined ? dateStyle === 'full' || dateStyle === 'long' : month === 'long';
    return datePart + (longGlue ? ' at ' : datePart === weekdayPart ? ' ' : ', ') + timePart;
  };

  // With Intl (the React runners), the realm's own formatting, in UTC unless
  // the code names a zone.
  const intl = options.intl;
  const withZone = (given) => {
    if (given === null) throw new NativeTypeError('Cannot convert undefined or null to object');
    const copy = {};
    if (given !== undefined) {
      const from = NativeObject(given);
      for (const key in from) copy[key] = from[key];
    }
    if (copy.timeZone === undefined) copy.timeZone = ${JSON.stringify(LEARNER_TIME_ZONE)};
    return copy;
  };
  const locale = (name, required, defaults) => (intl
    ? function (locales, given) { return apply(nativeLocale[name], this, [locales, withZone(given)]); }
    : function (locales, given) { return formatLocale(this, given, required, defaults); });

  const getter = (index) => function () {
    const t = timeOf(this);
    return t !== t ? NaN : fieldsOf(t)[index];
  };
  // setFullYear(y, m, d) .. setMilliseconds(ms): the arguments given replace
  // the local fields from position first on.
  const setter = (first, most) => function () {
    const t = timeOf(this);
    const count = arguments.length < 1 ? 1 : arguments.length > most ? most : arguments.length;
    const values = [];
    for (let i = 0; i < count; i++) values[i] = +arguments[i];
    if (t !== t && first !== 0) return NaN;
    const f = fieldsOf(t !== t ? 0 : t);
    for (let i = 0; i < count; i++) f[first + i] = values[i];
    const result = timeClip(makeTime(f[0], f[1], f[2], f[3], f[4], f[5], f[6]));
    apply(setTime, this, [result]);
    return result;
  };
  const methods = {
    getFullYear: getter(0), getMonth: getter(1), getDate: getter(2), getDay: getter(7),
    getHours: getter(3), getMinutes: getter(4), getSeconds: getter(5), getMilliseconds: getter(6),
    getTimezoneOffset: function () { const t = timeOf(this); return t !== t ? NaN : 0; },
    setFullYear: setter(0, 3), setMonth: setter(1, 2), setDate: setter(2, 1),
    setHours: setter(3, 4), setMinutes: setter(4, 3), setSeconds: setter(5, 2), setMilliseconds: setter(6, 1),
    toString: function () { return stringOf(timeOf(this)); },
    toDateString: function () { const t = timeOf(this); return t !== t ? 'Invalid Date' : dateText(fieldsOf(t)); },
    toTimeString: function () { const t = timeOf(this); return t !== t ? 'Invalid Date' : timeText(fieldsOf(t)); },
    toLocaleString: locale('toLocaleString', 'any', 'all'),
    toLocaleDateString: locale('toLocaleDateString', 'date', 'date'),
    toLocaleTimeString: locale('toLocaleTimeString', 'time', 'time'),
  };
  const lengths = { setFullYear: 3, setMonth: 2, setDate: 1, setHours: 4, setMinutes: 3, setSeconds: 2, setMilliseconds: 1 };
  if (typeof proto.getYear === 'function') {
    methods.getYear = function () { const t = timeOf(this); return t !== t ? NaN : fieldsOf(t)[0] - 1900; };
    methods.setYear = function (year) {
      const t = timeOf(this);
      const y = +year;
      if (y !== y) { apply(setTime, this, [NaN]); return NaN; }
      const whole = trunc(y);
      const f = fieldsOf(t !== t ? 0 : t);
      f[0] = whole >= 0 && whole <= 99 ? 1900 + whole : y;
      const result = timeClip(makeTime(f[0], f[1], f[2], f[3], f[4], f[5], f[6]));
      apply(setTime, this, [result]);
      return result;
    };
    lengths.setYear = 1;
  }

  const UtcDate = function Date(year, month, date, hours, minutes, seconds, ms) {
    const count = arguments.length;
    if (new.target === undefined) return stringOf(clock());
    let t;
    if (count === 0) t = timeClip(clock());
    else if (count === 1) {
      if (isDate(year)) t = timeOf(year);
      else {
        const value = toPrimitive(year);
        t = typeof value === 'string' ? parseText(value) : timeClip(+value);
      }
    } else {
      const y = +year, m = +month;
      const d = count > 2 ? +date : 1, h = count > 3 ? +hours : 0, mi = count > 4 ? +minutes : 0, s = count > 5 ? +seconds : 0, milli = count > 6 ? +ms : 0;
      const whole = trunc(y);
      t = timeClip(makeTime(y === y && whole >= 0 && whole <= 99 ? 1900 + whole : y, m, d, h, mi, s, milli));
    }
    return construct(NativeDate, [t], new.target);
  };
  const target = options.inPlace ? proto : NativeObject.create(proto);
  defineProperty(UtcDate, 'prototype', { value: target, writable: false, enumerable: false, configurable: false });
  const statics = {
    now: function now() { return clock(); },
    parse: function parse(text) { return parseText(NativeString(text)); },
    UTC: nativeUTC,
  };
  for (const name in statics) defineProperty(UtcDate, name, { value: statics[name], writable: true, enumerable: false, configurable: true });
  defineProperty(statics.parse, 'length', { value: 1, configurable: true });
  for (const name in methods) {
    defineProperty(methods[name], 'name', { value: name, configurable: true });
    defineProperty(methods[name], 'length', { value: lengths[name] || 0, configurable: true });
    defineProperty(target, name, { value: methods[name], writable: true, enumerable: false, configurable: true });
  }
  defineProperty(target, 'constructor', { value: UtcDate, writable: true, enumerable: false, configurable: true });

  if (intl && typeof intl.DateTimeFormat === 'function') {
    const NativeFormat = intl.DateTimeFormat;
    const DateTimeFormat = function DateTimeFormat(locales, given) {
      return new.target === undefined ? NativeFormat(locales, withZone(given)) : construct(NativeFormat, [locales, withZone(given)], new.target);
    };
    defineProperty(DateTimeFormat, 'prototype', { value: NativeFormat.prototype, writable: false, enumerable: false, configurable: false });
    defineProperty(DateTimeFormat, 'supportedLocalesOf', { value: NativeFormat.supportedLocalesOf, writable: true, enumerable: false, configurable: true });
    defineProperty(NativeFormat.prototype, 'constructor', { value: DateTimeFormat, writable: true, enumerable: false, configurable: true });
    defineProperty(intl, 'DateTimeFormat', { value: DateTimeFormat, writable: true, enumerable: false, configurable: true });
  }
  return UtcDate;
}`;

type UtcTimeFactory = (nativeDate: DateConstructor, options?: UtcTimeOptions) => DateConstructor;

/** Puts UTC into a realm that exists only for learner code (the Run worker,
 * the React frame): its `Date` is replaced and its local-time methods
 * rewritten. Compiled in that realm, like the learner console
 * (shared/coding-console.ts). */
export function installUtcTime(global: { Date: DateConstructor }, options: Omit<UtcTimeOptions, 'inPlace'> = {}): void {
  const factory = new Function(`return ${UTC_TIME_SOURCE};`)() as UtcTimeFactory;
  global.Date = factory(global.Date, { ...options, inPlace: true });
}
