/* =============================================================================
 * RoboForge — Robot Data (component library + report + pre-test + continuity)
 * -----------------------------------------------------------------------------
 * Pure, dependency-free. Runs in the browser (window.RobotData) and Node.
 *
 * PEDAGOGY: "teaching by doing mistakes". Nothing here pre-warns or blocks a
 * choice. computeReport() returns neutral FACTS. runPreTest() reveals pass/fail
 * ONLY when the student actually runs the test. Never gray out / disable parts.
 *
 * A "build" is: { brain, driver, motor, wheel, battery } of option ids
 *   (+ optional chassis: { widthU, lengthU, weightG }).
 * ========================================================================== */
(function (global) {
  'use strict';

  // Motors & wheels come in pairs (2 each) on a differential-drive robot.
  const COMPONENTS = {
    brain: {
      key: 'brain', label: 'Beyin', sub: 'Kontrolcü', icon: '🧠',
      help: 'Sensörleri okuyup motorlara karar veren bilgisayar.',
      options: [
        { id: 'uno',   name: 'Arduino Uno R3',   icon: '🔵', weightG: 25, voltage: 5,   drawMA: 50, cost: 3, power: 4, desc: 'Dayanıklı ve affedici. Eğitim için klasik.' },
        { id: 'nano',  name: 'Arduino Nano',     icon: '🟢', weightG: 7,  voltage: 5,   drawMA: 40, cost: 3, power: 4, desc: 'Küçük ve hafif. Dar şasilere sığar.' },
        { id: 'esp32', name: 'ESP32',            icon: '📡', weightG: 10, voltage: 3.3, drawMA: 90, cost: 5, power: 7, desc: 'Wi-Fi + hızlı çift çekirdek. Güç tüketir.' },
        { id: 'stm32', name: 'STM32 Blue Pill',  icon: '⚡', weightG: 6,  voltage: 3.3, drawMA: 45, cost: 4, power: 8, desc: 'Hızlı ARM. Elitlerin tercihi, öğrenmesi zor.' },
      ],
    },
    driver: {
      key: 'driver', label: 'Sürücü', sub: 'Motor Sürücü', icon: '⚡',
      help: 'Beyinin zayıf sinyalini motorları döndürecek güce çevirir.',
      options: [
        { id: 'l298n',   name: 'L298N',    icon: '🏗️', weightG: 30, maxA: 2.0,  minV: 5,   maxV: 35, eff: 0.6, cost: 2, desc: 'Ucuz ve dayanıklı. Isınır, pili emer.' },
        { id: 'tb6612',  name: 'TB6612FNG', icon: '🥷', weightG: 5,  maxA: 1.2,  minV: 2.5, maxV: 13, eff: 0.9, cost: 3, desc: 'Hafif ve verimli. Hızlı PWM.' },
        { id: 'drv8833', name: 'DRV8833',  icon: '🔋', weightG: 4,  maxA: 1.5,  minV: 2.7, maxV: 11, eff: 0.88, cost: 3, desc: 'Düşük voltaj uzmanı, mini boyut.' },
        { id: 'vnh5019', name: 'VNH5019',  icon: '💪', weightG: 35, maxA: 12.0, minV: 6,   maxV: 24, eff: 0.85, cost: 8, desc: 'Canavar güç. Büyük ve pahalı.' },
      ],
    },
    motor: {
      key: 'motor', label: 'Motor', sub: 'Tahrik (x2)', icon: '🔩',
      help: 'Tekerlekleri döndürür. RPM hızı, tork tırmanma gücünü belirler.',
      options: [
        { id: 'tt',       name: 'Sarı DC (TT)',    icon: '🟡', rpm: 200,  torque: 3, runA: 0.2,  peakA: 1.0, weightG: 30, voltage: 6, cost: 2, desc: 'Ucuz klasik. Yavaş ama yeter.' },
        { id: 'n20_300',  name: 'N20 300 RPM',     icon: '⚙️', rpm: 300,  torque: 7, runA: 0.15, peakA: 0.8, weightG: 10, voltage: 6, cost: 4, desc: 'Metal dişli, yüksek tork. Virajı kazır.' },
        { id: 'n20_1000', name: 'N20 1000 RPM',    icon: '🏎️', rpm: 1000, torque: 2, runA: 0.2,  peakA: 0.9, weightG: 10, voltage: 6, cost: 4, desc: 'Hız şeytanı. Düzlükte uçar, kontrolü zor.' },
        { id: 'pololu',   name: 'Pololu HP Micro', icon: '🏆', rpm: 500,  torque: 8, runA: 0.3,  peakA: 1.6, weightG: 12, voltage: 6, cost: 7, desc: 'Şampiyon motoru, encoder destekli.' },
      ],
    },
    wheel: {
      key: 'wheel', label: 'Tekerlek', sub: 'Zemin Teması (x2)', icon: '🛞',
      help: 'Yere temas eden tek nokta. Çap hızı, tutuş viraj kontrolünü belirler.',
      options: [
        { id: 'plastik65', name: '65mm Plastik', icon: '🔘', diaMM: 65, grip: 0.40, weightG: 15, cost: 1, desc: 'Standart. Her koşulda çalışır, virajda zayıf.' },
        { id: 'silikon43', name: '43mm Silikon', icon: '🛞', diaMM: 43, grip: 0.85, weightG: 12, cost: 3, desc: 'Yumuşak kauçuk. Virajda üstün tutuş.' },
        { id: 'yaris32',   name: '32mm Yarış',   icon: '🏁', diaMM: 32, grip: 0.30, weightG: 8,  cost: 3, desc: 'İnce pist lastiği. Az sürtünme, çok hız.' },
        { id: 'mecanum',   name: 'Mecanum Omni', icon: '🦀', diaMM: 60, grip: 0.50, weightG: 40, cost: 6, desc: 'Çok yönlü. Ağır ve karmaşık.' },
      ],
    },
    battery: {
      key: 'battery', label: 'Batarya', sub: 'Güç Kaynağı', icon: '🔋',
      help: 'Tüm sisteme enerji verir. Voltaj gücü, kapasite çalışma süresini belirler.',
      options: [
        { id: 'aa4',    name: '4x AA Pil', icon: '🔋', voltage: 6.0, mAh: 2000, weightG: 100, cost: 2, desc: 'Kolay bulunur, ağır.' },
        { id: 'lipo2s', name: 'Li-Po 2S',  icon: '⚡', voltage: 7.4, mAh: 1000, weightG: 60,  cost: 5, desc: 'Hafif ve güçlü. Dikkatli şarj.' },
        { id: 'li18650', name: '2x 18650', icon: '🔋', voltage: 7.4, mAh: 2600, weightG: 90,  cost: 4, desc: 'Uzun ömür, orta ağırlık.' },
      ],
    },
  };

  const ORDER = ['brain', 'driver', 'motor', 'wheel', 'battery'];

  function opt(cat, id) {
    const c = COMPONENTS[cat];
    if (!c || !id) return null;
    return c.options.find((o) => o.id === id) || null;
  }

  // ---- Report: neutral maker facts ----------------------------------------
  function computeReport(build) {
    const b = opt('brain', build.brain), d = opt('driver', build.driver),
      m = opt('motor', build.motor), w = opt('wheel', build.wheel), bat = opt('battery', build.battery);
    const chassisW = (build.chassis && build.chassis.weightG) || 60;

    const weightG = chassisW
      + (b ? b.weightG : 0) + (d ? d.weightG : 0)
      + (m ? m.weightG * 2 : 0) + (w ? w.weightG * 2 : 0) + (bat ? bat.weightG : 0);

    // top speed (m/s) = rpm/60 * pi * dia(m), lightly reduced by low grip (slip)
    let topSpeed = 0;
    if (m && w) {
      const raw = (m.rpm / 60) * Math.PI * (w.diaMM / 1000);
      const slip = 0.85 + 0.15 * w.grip;           // low grip => a little slip
      topSpeed = raw * slip;
    }
    // battery run-time (min): capacity / total running current
    let batteryMin = 0;
    if (bat) {
      const drawMA = (b ? b.drawMA : 0) + (m ? m.runA * 1000 * 2 : 0) + 40; // + driver overhead
      batteryMin = Math.round((bat.mAh / Math.max(50, drawMA)) * 60);
    }
    const torque = (m ? m.torque : 0);
    const grip = (w ? w.grip : 0);
    // composite power rating 0..100
    const powerRating = Math.round(Math.min(100,
      (m ? m.rpm / 15 : 0) * 0.4 + torque * 4 + grip * 25 + (b ? b.power * 3 : 0)));

    return {
      weightG: Math.round(weightG),
      topSpeed: +topSpeed.toFixed(2),
      topSpeedKmh: +(topSpeed * 3.6).toFixed(1),
      torque, grip: +grip.toFixed(2),
      batteryMin, powerRating,
      voltage: bat ? bat.voltage : 0,
    };
  }

  // ---- Pre-test: consequences revealed only when RUN --------------------
  // Returns ordered steps with ok/msg. First failing step => pass:false.
  function runPreTest(build) {
    const b = opt('brain', build.brain), d = opt('driver', build.driver),
      m = opt('motor', build.motor), w = opt('wheel', build.wheel), bat = opt('battery', build.battery);
    const steps = [];
    const add = (label, ok, msg) => steps.push({ label, ok, msg });

    // 1) power
    if (!bat) add('Güç kaynağı bağlanıyor…', false, 'Batarya yok — sisteme hiç güç gelmiyor. Bir batarya ekle.');
    else add('Güç kaynağı bağlanıyor…', true, bat.voltage + 'V hazır.');

    // 2) brain
    if (steps[steps.length - 1].ok) {
      if (!b) add('Beyin başlatılıyor…', false, 'Beyin (kontrolcü) yok — robot hiçbir karar veremez.');
      else add('Beyin başlatılıyor…', true, b.name + ' uyandı.');
    }
    // 3) driver
    if (steps[steps.length - 1].ok) {
      if (!d) add('Sürücü kontrol ediliyor…', false, 'Motor sürücü yok — beyin motoru doğrudan süremez, motor dönmez.');
      else add('Sürücü kontrol ediliyor…', true, d.name + ' bağlı.');
    }
    // 4) motor
    if (steps[steps.length - 1].ok) {
      if (!m) add('Motorlar deneniyor…', false, 'Motor yok — robot hareket edemez.');
      else if (d && d.maxA * 1.5 < m.peakA) add('Motorlar deneniyor…', false,
        'Sürücü (' + d.name + ', ' + d.maxA + 'A) motorun kalkış akımını (' + m.peakA + 'A) karşılayamıyor — motor zorlanıp duruyor.');
      else add('Motorlar deneniyor…', true, m.name + ' dönüyor.');
    }
    // 5) wheels
    if (steps[steps.length - 1].ok) {
      if (!w) add('Tekerleklere bakılıyor…', false, 'Tekerlek yok — motorlar dönse de robot ilerleyemez.');
      else add('Tekerleklere bakılıyor…', true, w.name + ' takılı.');
    }
    // 6) voltage sanity
    if (steps[steps.length - 1].ok) {
      if (m && bat && bat.voltage < m.voltage - 1.5) add('Hız ölçülüyor…', false,
        'Batarya voltajı (' + bat.voltage + 'V) motor için düşük (' + m.voltage + 'V) — robot çok güçsüz, kalkamıyor.');
      else if (d && bat && (bat.voltage < d.minV || bat.voltage > d.maxV)) add('Hız ölçülüyor…', false,
        'Batarya voltajı ' + d.name + ' sürücünün çalışma aralığı dışında (' + d.minV + '–' + d.maxV + 'V).');
      else {
        const r = computeReport(build);
        add('Hız ölçülüyor…', true, 'Ölçülen hız ≈ ' + r.topSpeedKmh + ' km/s.');
      }
    }

    const pass = steps.every((s) => s.ok);
    const rep = pass ? computeReport(build) : null;
    const notes = [];
    if (pass && rep) {
      if (rep.topSpeed < 0.6) notes.push('Robot çalışıyor ama çok yavaş — daha hızlı motor ya da büyük tekerlek dene.');
      if (rep.topSpeed > 3.0 && rep.grip < 0.45) notes.push('Çok hızlı ama tutuşu düşük — viraj/pistte savrulabilir.');
      if (rep.weightG > 400) notes.push('Robot ağır — hızlanması ve dönmesi yavaş olabilir.');
    }
    return { pass, steps, report: rep, notes };
  }

  // ---- Continuity: build -> Line Follower Lab sim params ------------------
  function toSimParams(build) {
    const rep = computeReport(build);
    const m = opt('motor', build.motor), w = opt('wheel', build.wheel);
    // top speed (m/s ~0.4..4) -> sim vMax (~2.2..6)
    let vMax = 2.0 + (rep.topSpeed || 1) * 1.15;
    vMax = Math.max(2.0, Math.min(6.0, vMax));
    // grip (0.3..0.85) -> turnGain (~0.85..1.5); heavy robots a touch sluggish
    let turnGain = 0.85 + (rep.grip || 0.5) * 0.75;
    turnGain *= Math.max(0.85, Math.min(1.08, 1 - (rep.weightG - 220) / 2200));
    turnGain = Math.max(0.8, Math.min(1.55, turnGain));
    const wheelBase = (build.chassis && build.chassis.widthU) ? Math.max(0.8, Math.min(1.5, build.chassis.widthU)) : 1.1;
    return { vMax: +vMax.toFixed(2), turnGain: +turnGain.toFixed(2), wheelBase };
  }

  function starterBuild() {
    return { brain: 'uno', driver: 'l298n', motor: 'tt', wheel: 'plastik65', battery: 'aa4' };
  }

  const API = { COMPONENTS, ORDER, opt, computeReport, runPreTest, toSimParams, starterBuild };
  global.RobotData = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
