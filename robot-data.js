/* =============================================================================
 * RoboForge - Robot Data (real component library + report + pre-test + sim link)
 * -----------------------------------------------------------------------------
 * Data imported from "RoboForge sim Build Materials.xlsx" (Cizgi Izleyen).
 * PEDAGOGY: learn by doing mistakes. Nothing pre-warns or blocks a choice.
 * computeReport() = neutral facts + 6 ratings. runPreTest() reveals consequences
 * ONLY when the student runs the test. Never gray out / disable parts.
 * A build = { brain, driver, motor:{type,rpm}, wheel, caster, battery, sensor }.
 * ========================================================================== */
(function (global) {
  'use strict';
  const COMPONENTS = {
  "brain": {
    "label": "Kontrol Kartı",
    "sub": "Beyin",
    "icon": "🧠",
    "help": "Sensörleri okuyup motorlara karar veren bilgisayar. İşlem gücü PID hızını, mantık voltajı sensör uyumunu belirler.",
    "options": [
      {
        "size": "Büyük",
        "difficulty": 2,
        "weightG": 25,
        "cost": 7,
        "k": {
          "speed": 1,
          "control": 2,
          "stab": 2,
          "eff": 3,
          "dur": 3,
          "tork": 0
        },
        "max": 1,
        "pros": "Robotik dünyasının en geniş kütüphane desteğine sahiptir. Başlangıç seviyesi algoritmaları test etmek ve sensör okumalarını temel düzeyde öğrenmek için en risksiz, donanımsal olarak en sağlam platformdur.",
        "cons": "25 gramlık ağırlığı ve devasa fiziksel hacmi, aerodinamik ve hafif bir şasi tasarımını imkansız kılar. 16 MHz işlemcisi, yüksek hızlarda çalışan sensör okumalarını ve PID döngüsünü yetiştirmekte darboğaza düşer.",
        "id": "uno",
        "name": "Arduino Uno",
        "icon": "🔵",
        "cpu": 2,
        "logicV": 5,
        "drawMA": 50.0,
        "pinMA": 40.0,
        "pins": 20
      },
      {
        "size": "Küçük",
        "difficulty": 3,
        "weightG": 7,
        "cost": 7,
        "k": {
          "speed": 1,
          "control": 2,
          "stab": 2,
          "eff": 3,
          "dur": 2,
          "tork": 0
        },
        "max": 1,
        "pros": "Uno'nun 16 MHz'lik tam gücünü sadece 7 gramlık mikro bir form faktöründe sunar. Küçük şasilerin ağırlık merkezini aşağı çekmek için mükemmel bir donanımdır.",
        "cons": "Uno ile aynı eski 8-bit mimariyi kullandığı için, saniyede binlerce kez çalışması gereken otonom PID hesaplamalarında yetersiz kalır ve QTR-8A (Analog) gibi sensörlerle iletişimde gecikme yaratır.",
        "id": "nano",
        "name": "Arduino Nano",
        "icon": "🟢",
        "cpu": 2,
        "logicV": 5,
        "drawMA": 30.0,
        "pinMA": 40.0,
        "pins": 22
      },
      {
        "size": "Küçük",
        "difficulty": 8,
        "weightG": 10,
        "cost": 5,
        "k": {
          "speed": 3,
          "control": 2,
          "stab": 1,
          "eff": 1,
          "dur": 2,
          "tork": 0
        },
        "max": 1,
        "pros": "240 MHz çift çekirdekli işlemcisiyle inanılmaz bir hesaplama gücü sunar. Üzerindeki dahili Wi-Fi/Bluetooth modülleri sayesinde, robottan canlı telemetri ve PID hata verilerini kablosuz olarak çekmek için muazzam bir araçtır.",
        "cons": "3.3V mantık seviyesiyle çalışır. 5V ile çalışan standart çizgi sensörleriyle arasına seviye dönüştürücü koyulmazsa veri kayıpları veya pin yanmaları yaşatabilir.",
        "id": "esp32",
        "name": "ESP-32",
        "icon": "📡",
        "cpu": 9,
        "logicV": 3.3,
        "drawMA": 240.0,
        "pinMA": 40.0,
        "pins": 34
      },
      {
        "size": "Küçük",
        "difficulty": 9,
        "weightG": 8,
        "cost": 1,
        "k": {
          "speed": 5,
          "control": 4,
          "stab": 4,
          "eff": 2,
          "dur": 4,
          "tork": 0
        },
        "max": 1,
        "pros": "72 MHz 32-bit ARM Cortex-M3 mimarisi, profesyonel çizgi izleyen robotların \"Altın Standardı\"dır. Donanımsal timer'ları sayesinde motorlara kusursuz, sıfır gecikmeli PWM sinyali göndererek robotun yola kilitlenmesini sağlar.",
        "cons": "Gömülü yazılım bilgisi gerektirir. C/C++ ile HAL kütüphaneleri üzerinden programlamasının öğrenme eğrisi çok diktir; acemi oyuncuların konfor alanının dışındadır.",
        "id": "stm32",
        "name": "STM32 Blue Pill",
        "icon": "⚡",
        "cpu": 7,
        "logicV": 3.3,
        "drawMA": 40.0,
        "pinMA": 20.0,
        "pins": 37
      }
    ]
  },
  "driver": {
    "label": "Motor Sürücü",
    "sub": "Güç Katı",
    "icon": "⚡",
    "help": "Beynin zayıf sinyalini motoru döndürecek güce çevirir. Maks. voltaj ve akım sınırı, hangi motoru/bataryayı kaldıracağını belirler.",
    "options": [
      {
        "size": "Standart",
        "difficulty": 5,
        "weightG": 41,
        "cost": 2,
        "k": {
          "speed": -3,
          "control": -2,
          "stab": -1,
          "eff": -2,
          "dur": -2,
          "tork": -2
        },
        "max": 4,
        "pros": "İçerisinde dahili koruma diyotları bulunur. Minik akımlar çeken eğitim projeleri ve risksiz başlangıçlar için harika bir \"İlk Sürücü\" deneyimidir.",
        "cons": "Pilden aldığı gücün yaklaşık 1.5 Volt'unu ısıya dönüştürüp çöpe atar. Kanal başına sadece 600mA akım verebilir; sisteme 370 serisi gibi güçlü bir motor takıldığında saniyeler içinde kullanılamaz hale gelir.",
        "id": "l293d",
        "name": "L293D",
        "icon": "🧱",
        "logicVmin": 5.0,
        "logicVmax": 5.0,
        "maxMotorV": 36,
        "maxOutAperCh": 1.2,
        "motorSlots": 4
      },
      {
        "size": "Mikro",
        "difficulty": 5,
        "weightG": 3,
        "cost": 3,
        "k": {
          "speed": 3,
          "control": 4,
          "stab": 3,
          "eff": 5,
          "dur": 4,
          "tork": 3
        },
        "max": 6,
        "pros": "MOSFET tabanlı modern yapısı sayesinde güç kaybı neredeyse sıfırdır. Pilden gelen yüksek akımı ısınmadan doğrudan motorlara iletir, yüksek frekanslı PWM sinyallerine saniyesinde tepki verir.",
        "cons": "Çip elektriksel darbelere karşı çok hassastır; en ufak bir ters kutup bağlamasında veya motorun anlık kilitlenmesinden (stall) kaynaklanan aşırı akımda yanabilir.",
        "id": "tb6612",
        "name": "TB6612FNG",
        "icon": "🥷",
        "logicVmin": 2.7,
        "logicVmax": 5.5,
        "maxMotorV": 15,
        "maxOutAperCh": 3.2,
        "motorSlots": 2
      },
      {
        "size": "Mikro",
        "difficulty": 4,
        "weightG": 2,
        "cost": 2,
        "k": {
          "speed": 2,
          "control": 3,
          "stab": 3,
          "eff": 4,
          "dur": 3,
          "tork": 2
        },
        "max": 6,
        "pros": "Düşük voltajlarda inanılmaz verimli çalışan, içinde dahili termal akım koruması bulunan çok dayanıklı bir mikro sürücüdür. Kompakt robotlar için şaside yer kaplamaz.",
        "cons": "Maksimum çalışma voltajı 10.8V ile sınırlandırılmıştır. Sisteme sürat için 3S LiPo (11.1V) bağlandığı anda çip bu gerilimi tolere edemez ve saniyeler içinde yanarak sistemi çökertir.",
        "id": "drv8833",
        "name": "DRV8833",
        "icon": "🔋",
        "logicVmin": 3.3,
        "logicVmax": 5.0,
        "maxMotorV": 10.8,
        "maxOutAperCh": 2.0,
        "motorSlots": 2
      },
      {
        "size": "Büyük",
        "difficulty": 6,
        "weightG": 6.5,
        "cost": 10,
        "k": {
          "speed": 3,
          "control": 4,
          "stab": 3,
          "eff": 4,
          "dur": 5,
          "tork": 4
        },
        "max": 2,
        "pros": "Tam bir endüstriyel sürücüdür. 30 Amper anlık şok, 12 Amper sürekli akım dayanımıyla robottaki hiçbir motor bu çipi yakamaz. Ters voltaj korumasına ve anlık akım okuma gibi üst düzey özelliklere sahiptir.",
        "cons": "Kartın fiziksel hacmi ve ağırlığı, çizgi izleyen gibi hafif ve çevik robotlar için devasadır. Pahalıdır.",
        "id": "vnh5019",
        "name": "VNH5019",
        "icon": "💪",
        "logicVmin": 3.3,
        "logicVmax": 5.0,
        "maxMotorV": 24,
        "maxOutAperCh": 30.0,
        "motorSlots": 2
      }
    ]
  },
  "motor": {
    "label": "Motor",
    "sub": "Tahrik (x2)",
    "icon": "🔩",
    "typed": true,
    "help": "Önce motor tipini, sonra RPM'ini seç. RPM hızı, tork tırmanma/kalkış gücünü verir. İki tahrik motoru olarak takılır.",
    "types": [
      {
        "id": "tt",
        "type": "Sarı DC (TT)",
        "icon": "🟡",
        "variants": [
          {
            "size": "Büyük",
            "difficulty": 2,
            "weightG": 29,
            "cost": 1,
            "k": {
              "speed": -2,
              "control": -2,
              "stab": 0,
              "eff": 3,
              "dur": -3,
              "tork": -3
            },
            "max": 8,
            "pros": "6V gerilimde çektiği maksimum 160mA akım sayesinde, sıradan kalem pillerle bile saatlerce çalışır. Kullanıcıların PID ayarlarının mantığını görerek kavraması için tasarlanmış, çok yavaş ve risksiz bir \"Eğitim\" motorudur.",
            "cons": "Sarı plastik dişli kutusu çok yer kaplar; şasiyi havaya kaldırarak sensörlerin pisti görmesini engeller. Ayrıca plastik dişlilerinde \"boşluk\" vardır; robot düz gitmekte zorlanır ve ufak bir kazada dişliler içeriden kırılır.",
            "rpm": 250,
            "torque": 2,
            "runMA": 160.0,
            "surgeA": 0.35
          }
        ]
      },
      {
        "id": "m370",
        "type": "370 Fırçalı",
        "icon": "🔩",
        "variants": [
          {
            "size": "Standart",
            "difficulty": 5,
            "weightG": 28,
            "cost": 7,
            "k": {
              "speed": 2,
              "control": 2,
              "stab": 1,
              "eff": -1,
              "dur": 4,
              "tork": 3
            },
            "max": 8,
            "pros": "Kalın metal redüktörü ve devasa itme gücüyle (tork) adeta bir tank gibidir. Ağır gövdeli robotları rahatça kaldırır, virajlarda momentum kaybetmeden ivmelenmeyi sürdürür.",
            "cons": "28 gramlık ağır çelik gövdesi, şasinin toplam ağırlığını ciddi şekilde artırır. Ani kalkışlarda çok yüksek akım çektiği için zayıf pilleri anında çökertir",
            "rpm": 2000,
            "torque": 8,
            "runMA": 670.0,
            "surgeA": 1.47
          },
          {
            "size": "Standart",
            "difficulty": 7,
            "weightG": 28,
            "cost": 7,
            "k": {
              "speed": 4,
              "control": 1,
              "stab": -1,
              "eff": -2,
              "dur": 3,
              "tork": 2
            },
            "max": 8,
            "pros": "Uzun düzlüklerde sınırları zorlamak için tasarlanmış yüksek voltaj (14V) toleranslı bir performans canavarıdır. Ağır gövdeleri bile limit hızlarına rahatça ulaştırır.",
            "cons": "Hız arttıkça 28 gramlık demir kütlenin yarattığı merkezcil ivme, robotu virajlarda dışarı doğru savurmaya başlar; bu motoru zapt etmek çok agresif bir yazılım (PID) gerektirir.",
            "rpm": 4000,
            "torque": 7,
            "runMA": 320.0,
            "surgeA": 0.7
          },
          {
            "size": "Standart",
            "difficulty": 9,
            "weightG": 27,
            "cost": 7,
            "k": {
              "speed": 5,
              "control": -3,
              "stab": -4,
              "eff": -4,
              "dur": 2,
              "tork": 1
            },
            "max": 8,
            "pros": "Mutlak fiziksel limit. Profesyonel ligin şampiyonluk motorudur. 3S LiPo batarya ve TB6612 sürücüyle birleştiğinde pistte durdurulamaz bir tepe hız sunar.",
            "cons": "Durdurma (Stall) anında motor başına 6 Amper gibi devasa bir güç sömürür. En ufak bir kodlama hatasında robot yoldan çıkarak füze gibi duvara çarpar.",
            "rpm": 5000,
            "torque": 6,
            "runMA": 450.0,
            "surgeA": 0.99
          }
        ]
      },
      {
        "id": "n20",
        "type": "N20 Mikro Metal",
        "icon": "⚙️",
        "variants": [
          {
            "size": "Küçük",
            "difficulty": 4,
            "weightG": 9,
            "cost": 4,
            "k": {
              "speed": 3,
              "control": 3,
              "stab": 3,
              "eff": 2,
              "dur": 2,
              "tork": -2
            },
            "max": 8,
            "pros": "Hız ve kontrol arasındaki kusursuz mühendislik dengesidir. Sadece 9 gramlık ağırlığıyla hafif şasilerde aerodinamiği bozmadan son derece güvenli bir yol tutuşu sağlar.",
            "cons": "Dişli oranı (RPM) yüksek olduğu için mekanik torku düşüktür. Sisteme 18650 gibi ağır bir batarya eklendiğinde veya devasa tekerlekler takıldığında zorlanabilir.",
            "rpm": 3000,
            "torque": 3,
            "runMA": 270.0,
            "surgeA": 0.59
          },
          {
            "size": "Küçük",
            "difficulty": 8,
            "weightG": 9,
            "cost": 4,
            "k": {
              "speed": 5,
              "control": -2,
              "stab": -2,
              "eff": -3,
              "dur": -2,
              "tork": -4
            },
            "max": 8,
            "pros": "Hafif sıklet robotları pistte uçurmak için yaratılmıştır. İnanılmaz RPM değeri sayesinde, robot hafif tutulduğu sürece düzlükleri göz açıp kapayıncaya kadar bitirir.",
            "cons": "Tork değeri adeta yok gibidir. Sisteme en ufak bir ekstra ağırlık eklendiğinde motor dönmeyi bırakır ve olduğu yerde akım çekerek pili ısıtır.",
            "rpm": 5000,
            "torque": 1,
            "runMA": 450.0,
            "surgeA": 0.99
          }
        ]
      },
      {
        "id": "coreless",
        "type": "Coreless Planet",
        "icon": "🚀",
        "variants": [
          {
            "size": "Küçük",
            "difficulty": 7,
            "weightG": 15,
            "cost": 10,
            "k": {
              "speed": 4,
              "control": 4,
              "stab": 2,
              "eff": -2,
              "dur": -1,
              "tork": 1
            },
            "max": 8,
            "pros": "Çekirdeksiz (coreless) yapısı sayesinde eylemsizlik momenti sıfıra yakındır. Motora voltaj verildiği salise maksimum devre ulaşır, robot viraj çıkışlarında roket gibi fırlar.",
            "cons": "Tedarik etmesi en maliyetli donanımdır. Narin dişli yapısı, pistten çıkma ve sert darbe alma gibi durumlarda kolayca dişli sıyırmasına (kırılmasına) neden olur.",
            "rpm": 2000,
            "torque": 6,
            "runMA": 2500.0,
            "surgeA": 5.5
          }
        ]
      }
    ]
  },
  "wheel": {
    "label": "Tahrik Tekerleği",
    "sub": "Zemin Teması (x2)",
    "icon": "🛞",
    "help": "Yere basan tekerlek. Çap teorik hızı, tutuş viraj kontrolünü belirler. Çok büyük çap sensörü yerden yükseltir.",
    "options": [
      {
        "size": "Mikro",
        "difficulty": 3,
        "weightG": 5,
        "cost": 9,
        "k": {
          "speed": -3,
          "control": 5,
          "stab": 5,
          "eff": 2,
          "dur": 9,
          "tork": 2
        },
        "max": 8,
        "pros": "Şasiyi yere milimetrelerce yaklaştırarak (Lowrider) ağırlık merkezini en dibe çeker. Yüzey sürtünme katsayısı kusursuzdur, yüksek hızlarda viraja girildiğinde devrilme/takla atma riskini tamamen siler.",
        "cons": "Çapı çok küçük olduğu için 370 gibi kaba/kalın gövdeli motorlarla kullanıldığında, motorun metal dış gövdesi yere sürterek robotu kilitler. Alüminyum jantın şafta montajı zordur.",
        "id": "w20",
        "name": "Mikro Silikon Tekerlek",
        "icon": "🔘",
        "diaMM": 20,
        "grip": 9
      },
      {
        "size": "Küçük",
        "difficulty": 5,
        "weightG": 3.4,
        "cost": 5,
        "k": {
          "speed": 2,
          "control": 3,
          "stab": 2,
          "eff": 3,
          "dur": 5,
          "tork": 2
        },
        "max": 8,
        "pros": "Çizgi izleyen araçların standart altın oranıdır. Şasi altı yüksekliğini optimum seviyede tutarak hem motorların yere sürtmesini engeller hem de sensörlerin pisti net görmesini sağlar.",
        "cons": "Zemin tozluysa veya kirliyse, yumuşak yapışkan doku bu tozu anında hapseder ve tekerlekler virajlarda buz pateni gibi dışa doğru kaymaya başlar.",
        "id": "w32",
        "name": "Silikon Tekerlek",
        "icon": "🛞",
        "diaMM": 32,
        "grip": 6
      },
      {
        "size": "Büyük",
        "difficulty": 6,
        "weightG": 38,
        "cost": 1,
        "k": {
          "speed": 4,
          "control": -2,
          "stab": 2,
          "eff": -2,
          "dur": 8,
          "tork": -3
        },
        "max": 8,
        "pros": "Kauçuk dokusu ve dişli yapısı sayesinde engebeli, zorlu zeminlerde yüksek performans sunar. Tekerlek çapı büyük olduğu için teorik düz yol hızını yükseltir.",
        "cons": "Devasa boyutu şasiyi çok yükseğe kaldırır. QTR gibi kızılötesi ışıkla çalışan hassas sensörler bu yükseklikten zemini okuyamaz ve robot çizgiyi kaybeder.",
        "id": "w65",
        "name": "Standart Kauçuk Tekerlek",
        "icon": "⭕",
        "diaMM": 65,
        "grip": 4
      }
    ]
  },
  "caster": {
    "label": "Sarhoş Tekerlek",
    "sub": "Denge Noktası",
    "icon": "🎳",
    "help": "Robotun serbest dönen denge tekerleği. Ağırlığı ve sürtünmesi keskin virajlardaki çevikliği etkiler.",
    "options": [
      {
        "size": "Küçük",
        "difficulty": 2,
        "weightG": 41,
        "cost": 1,
        "k": {
          "speed": 1,
          "control": 2,
          "stab": 3,
          "eff": 2,
          "dur": 5,
          "tork": 0
        },
        "max": 6,
        "pros": "Pürüzsüz çelik bilyası sayesinde yön değişimlerinde sürtünme katsayısı minimumdur. Robot keskin zik-zaklara girerken kafasını hiç enerji kaybetmeden yağ gibi kayarak çevirir.",
        "cons": "15 gramlık kütlesi, robotun ön tarafındaki ağırlık dengesini bozar. Arkadan itişli robotlarda ön tarafı yere gereksiz baskılayarak düşük torklu motorların gücünü sömürür.",
        "id": "cmetal",
        "name": "Metal Bilyalı Sarhoş Tekerlek",
        "icon": "🔩"
      },
      {
        "size": "Mikro",
        "difficulty": 1,
        "weightG": 4,
        "cost": 1,
        "k": {
          "speed": 0,
          "control": 2,
          "stab": 1,
          "eff": 2,
          "dur": 1,
          "tork": -1
        },
        "max": 6,
        "pros": "Yalnızca 4 gramlık tüy gibi hafif yapısıyla aerodinamiği ve ağırlık merkezini asla bozmaz. Küçük şasilerin altına kolayca yerleştirilip maksimum alan tasarrufu sağlar.",
        "cons": "Plastik bilya ve yatağı yüksek hızlarda çabuk aşınır. Pistteki ufak bir toz yuvanın içine kaçtığında dönmeyi bırakabilir ve zımpara gibi yere sürtünerek robotu yavaşlatabilir.",
        "id": "cplastik",
        "name": "Plastik Sarhoş Tekerlek",
        "icon": "⚪"
      }
    ]
  },
  "battery": {
    "label": "Batarya",
    "sub": "Güç Kaynağı",
    "icon": "🔋",
    "help": "Sisteme enerji verir. Voltaj hızı/gücü, mAh çalışma süresini, deşarj akımı ani kalkışta voltajın çökmemesini belirler.",
    "options": [
      {
        "size": "Büyük",
        "difficulty": 1,
        "weightG": 96,
        "cost": 3,
        "k": {
          "speed": -4,
          "control": -2,
          "stab": -1,
          "eff": -3,
          "dur": 4,
          "tork": -2
        },
        "max": 4,
        "pros": "LiPo piller gibi patlama, yanma, şişme veya özel şarj aleti gerektirme derdi yoktur. Kullanıcı için %100 güvenlidir. L293 sürücüsü ve Sarı TT motorlarla birleştiğinde kusursuz bir öğrenim aracıdır.",
        "cons": "4 adet alkalin pil ve plastik yuvası yaklaşık 110 gram tutar, şaside devasa bir yer işgal eder. Maksimum deşarj (anlık akım) sınırı sadece 1 Amperdir. Sisteme 370 veya Coreless gibi profesyonel motorlar eklendiği an voltaj çöker ve robot kalkış yapamadan reset atar.",
        "id": "aa4",
        "name": "4xAA Kalem Pİl",
        "icon": "🔋",
        "voltage": 6,
        "mAh": 2000,
        "dischargeA": 1.2
      },
      {
        "size": "Küçük",
        "difficulty": 6,
        "weightG": 48,
        "cost": 5,
        "k": {
          "speed": 3,
          "control": 3,
          "stab": 4,
          "eff": -2,
          "dur": 2,
          "tork": 2
        },
        "max": 6,
        "pros": "Hafif sıklet performans şampiyonudur. Yüksek deşarj oranlarıyla motorların anlık kalkış akımlarını, voltajı zerre kadar düşürmeden kusursuzca karşılar.",
        "cons": "850mAh kapasitesi rekabetçi kullanımlarda çok düşüktür; agresif testlerde dakikalar içinde biter. Hücre voltajı 3.2V'un altına düşürülürse pil anında şişer ve bir daha kullanılamaz.",
        "id": "lipo2s",
        "name": "2S LiPo",
        "icon": "⚡",
        "voltage": 7.4,
        "mAh": 850,
        "dischargeA": 25.5
      },
      {
        "size": "Büyük",
        "difficulty": 2,
        "weightG": 88,
        "cost": 4,
        "k": {
          "speed": 1,
          "control": 1,
          "stab": 2,
          "eff": 5,
          "dur": 5,
          "tork": 1
        },
        "max": 6,
        "pros": "Devasa kapasitesiyle gün boyu şarja takmadan parametre testleri yapmayı sağlar. Kimyasal ömrü çok uzundur ve LiPo piller gibi kolay kolay şişme/patlama riski taşımaz.",
        "cons": "İki adet çelik hücre ve yuvası robotun sırtına adeta bir tuğla bağlamak gibidir. Düşük deşarj sınırına sahip olduğu için, ani ivmelenmelerde motorları ihtiyacı olan akımdan mahrum bırakır.",
        "id": "li18650",
        "name": "2x 18650 Lityum İyon",
        "icon": "🔋",
        "voltage": 7.4,
        "mAh": 2500,
        "dischargeA": 10.0
      },
      {
        "size": "Standart",
        "difficulty": 8,
        "weightG": 80,
        "cost": 10,
        "k": {
          "speed": 5,
          "control": -1,
          "stab": -1,
          "eff": 3,
          "dur": 2,
          "tork": 4
        },
        "max": 5,
        "pros": "11.1V gibi yüksek bir nominal gerilimle motorları limitlerinin ötesinde bir RPM'e çıkararak radikal bir güç artışı sağlar. Çizgi izleyen rekortmenlerinin tek tercihidir.",
        "cons": "DRV8833 sürücüleri veya düşük voltajlı mikro motorları saniyeler içinde yakarak tüm donanımı çöpe çevirir. 80 gramlık yapısıyla ince robotların ağırlık merkezini tehlikeli şekilde yukarı taşır.",
        "id": "lipo3s",
        "name": "3S LiPo",
        "icon": "🔥",
        "voltage": 11.1,
        "mAh": 1000,
        "dischargeA": 30.0
      }
    ]
  },
  "sensor": {
    "label": "Çizgi Sensörü",
    "sub": "Gözler",
    "icon": "👁️",
    "help": "Çizgiyi görür. Çözünürlüğü PID pürüzsüzlüğünü, mantık voltajı beyinle uyumu, yerden yüksekliğe hassasiyeti belirler.",
    "options": [
      {
        "size": "Küçük",
        "difficulty": 7,
        "weightG": 3.1,
        "cost": 8,
        "k": {
          "speed": 4,
          "control": 4,
          "stab": 5,
          "eff": 3,
          "dur": 4,
          "tork": 0
        },
        "max": 5,
        "pros": "8 adet yüksek hassasiyetli kızılötesi okuyucu içerir. Direnç-Kapasitör deşarj süresi mantığıyla çalıştığı için işlemcinin donanımını yormadan milimetrik pozisyon verisi sunar.",
        "cons": "Pahalı bir sensördür. Havaya kaldırıldığı veya büyük tekerleklerle (Örn: 65mm) zemin mesafesi açıldığı an ışık yansımasını kaybedip körleşir; robot pistten çıkar.",
        "id": "qtr8rc",
        "name": "QTR-8RC",
        "icon": "👁️",
        "logicVmin": 3.3,
        "logicVmax": 5.0,
        "drawMA": 100.0,
        "quality": 1.0,
        "analog": false,
        "digital1": false
      },
      {
        "size": "Küçük",
        "difficulty": 8,
        "weightG": 3.1,
        "cost": 8,
        "k": {
          "speed": 2,
          "control": 3,
          "stab": 3,
          "eff": 2,
          "dur": 4,
          "tork": 0
        },
        "max": 5,
        "pros": "Sensörlerin yansıma verisini analog voltaj (0-5V) olarak aktarır. Deneyimli kişilerin kendi filtreleme algoritmalarını yazarak pürüzsüz bir PID döngüsü kurmasına olanak tanır.",
        "cons": "Eski 8-bit mikrodenetleyiciler (Uno, Nano) 8 farklı analog pini art arda okurken ciddi saat döngüleri harcar, bu da ana yazılım algoritmasında darboğaz (gecikme) yaratır.",
        "id": "qtr8a",
        "name": "QTR-8A",
        "icon": "📶",
        "logicVmin": 3.3,
        "logicVmax": 5.0,
        "drawMA": 100.0,
        "quality": 0.85,
        "analog": true,
        "digital1": false
      },
      {
        "size": "Standart",
        "difficulty": 4,
        "weightG": 0.23,
        "cost": 1,
        "k": {
          "speed": -2,
          "control": -2,
          "stab": -2,
          "eff": 1,
          "dur": 3,
          "tork": 0
        },
        "max": 16,
        "pros": "Üzerindeki trimpot (vida) ile okuma eşiği donanımsal olarak elle ayarlanır. Kodlaması \"Siyah gördüm (1) - Beyaz gördüm (0)\" kadar basittir; bütçe dostu, sağlam ve başlangıç seviyesi bir sensördür.",
        "cons": "1 ve 0 mantığında ara değer okuyamadığı için pürüzsüz PID yapılamaz. 4000+ RPM yüksek hızlı motorlarla kullanıldığında, robot virajı algılayana kadar pistten çıkar.",
        "id": "tcrt5000",
        "name": "TCRT5000",
        "icon": "🔴",
        "logicVmin": 5.0,
        "logicVmax": 5.0,
        "drawMA": 40.0,
        "quality": 0.45,
        "analog": false,
        "digital1": true
      }
    ]
  }
};

  const ORDER=['brain','driver','motor','wheel','caster','battery','sensor'];
  const RATING_KEYS=['speed','control','stab','eff','dur','tork'];
  const RATING_LABEL={speed:'Hız',control:'Kontrol',stab:'Stabilite',eff:'Verim',dur:'Dayanıklık',tork:'Tork'};

  function opt(cat,sel){
    const c=COMPONENTS[cat]; if(!c||sel==null) return null;
    if(cat==='motor'){
      const t=(c.types||[]).find(t=>t.id===(sel.type||sel)); if(!t) return null;
      const rpm=(sel.rpm!=null)?+sel.rpm:(t.variants[0]&&t.variants[0].rpm);
      const v=t.variants.find(v=>v.rpm===rpm)||t.variants[0];
      return v?Object.assign({typeId:t.id,typeName:t.type,name:t.type+' '+v.rpm+' RPM',icon:t.icon},v):null;
    }
    return c.options.find(o=>o.id===(sel.id||sel))||null;
  }
  function motorType(id){ return (COMPONENTS.motor.types||[]).find(t=>t.id===id)||null; }
  function parts(build){ build=build||{}; return {
    brain:opt('brain',build.brain),driver:opt('driver',build.driver),motor:opt('motor',build.motor),
    wheel:opt('wheel',build.wheel),caster:opt('caster',build.caster),battery:opt('battery',build.battery),
    sensor:opt('sensor',build.sensor)}; }

  function ratings(build){
    const p=parts(build); const chosen=[p.brain,p.driver,p.motor,p.wheel,p.caster,p.battery,p.sensor].filter(Boolean);
    const out={};
    RATING_KEYS.forEach(k=>{ let sum=0; chosen.forEach(o=>{ sum+=(o.k&&typeof o.k[k]==='number')?o.k[k]:0; });
      out[k]=Math.max(0,Math.min(10,Math.round(5+sum*0.24))); out[k+'Raw']=sum; });
    return out;
  }

  function computeReport(build){
    const p=parts(build); const chassisW=(build&&build.chassis&&build.chassis.weightG)||55;
    const q=counts(build);
    const weightG=chassisW+ORDER.reduce(function(a,cat){ return a+((p[cat]?p[cat].weightG:0)*(q[cat]||0)); },0);
    let topSpeed=0,effRpm=0;
    if(p.motor&&p.wheel){
      const vfac=p.battery?Math.max(0.7,Math.min(1.55,p.battery.voltage/7.4)):1;
      effRpm=p.motor.rpm*vfac; const slip=0.78+0.022*(p.wheel.grip||5);
      topSpeed=(effRpm/60)*Math.PI*(p.wheel.diaMM/1000)*slip;
    }
    let batteryMin=0,drawMA=0;
    if(p.battery){ drawMA=(p.brain?p.brain.drawMA*q.brain:0)+(p.motor?p.motor.runMA*q.motor:0)+(p.sensor?p.sensor.drawMA*q.sensor:0)+15;
      batteryMin=Math.round((p.battery.mAh/Math.max(60,drawMA))*60); }
    const cost=['brain','driver','wheel','caster','battery','sensor'].reduce((a,k)=>a+((p[k]&&p[k].cost)||0),0)+(p.motor?p.motor.cost:0);
    const powerRating=Math.max(0,Math.min(100,Math.round((p.motor?p.motor.torque*6:0)+effRpm/120+(p.battery?p.battery.voltage*2.2:0))));
    return {weightG:Math.round(weightG),topSpeed:+topSpeed.toFixed(2),topSpeedKmh:+(topSpeed*3.6).toFixed(1),
      effRpm:Math.round(effRpm),torque:p.motor?p.motor.torque:0,grip:p.wheel?p.wheel.grip:0,
      drawMA:Math.round(drawMA),batteryMin,cost,powerRating,voltage:p.battery?p.battery.voltage:0,ratings:ratings(build)};
  }

  function runPreTest(build){
    // Sifir adet yerlestirilen parca "yok" sayilir: serbest yerlestirme testte ortaya cikar.
    const qc=counts(build); const p0=parts(build); const p={};
    ORDER.forEach(function(k){ p[k]=((qc[k]||0)>0)?p0[k]:null; });
    const steps=[]; const add=(l,ok,m)=>steps.push({label:l,ok:ok,msg:m});
    const cont=()=>steps.length===0||steps[steps.length-1].ok;
    if(!p.battery) add('Güç kaynağı bağlanıyor...',false,'Batarya yok - sisteme hiç güç gelmiyor.');
    else add('Güç kaynağı bağlanıyor...',true,p.battery.name+' ('+p.battery.voltage+'V) hazır.');
    if(cont()){ if(!p.brain) add('Beyin başlatılıyor...',false,'Kontrol kartı yok - robot karar veremez.');
      else add('Beyin başlatılıyor...',true,p.brain.name+' uyandı.'); }
    if(cont()){ if(!p.driver) add('Sürücü kontrol ediliyor...',false,'Motor sürücü yok - beyin motoru süremez.');
      else add('Sürücü kontrol ediliyor...',true,p.driver.name+' bağlı.'); }
    if(cont()){ if(!p.motor) add('Motorlar aranıyor...',false,'Motor yok - robot hareket edemez.');
      else if(!p.wheel) add('Tekerlekler aranıyor...',false,'Tahrik tekerleği yok - robot ilerleyemez.');
      else if(!p.sensor) add('Sensör aranıyor...',false,'Çizgi sensörü yok - robot çizgiyi göremez.');
      else add('Bağlantılar taranıyor...',true,'Tüm temel parçalar yerinde.'); }
    if(cont()&&p.battery&&p.driver&&p.battery.voltage>p.driver.maxMotorV+0.2)
      add('Sürücüye güç veriliyor...',false,p.battery.name+' '+p.battery.voltage+'V veriyor; '+p.driver.name+' en fazla '+p.driver.maxMotorV+'V kaldırır. Çip aşırı gerilimden yanıyor.');
    else if(cont()) add('Sürücüye güç veriliyor...',true,'Sürücü voltajı güvenli.');
    if(cont()&&p.driver&&p.motor&&qc.motor>p.driver.motorSlots)
      add('Kanallar sayılıyor...',false,p.driver.name+' en fazla '+p.driver.motorSlots+' motor kanalı sürer; sen '+qc.motor+' motor taktın. Fazla motorlar dönmez.');
    else if(cont()&&p.driver&&p.motor) add('Kanallar sayılıyor...',true,qc.motor+' motor / '+p.driver.motorSlots+' kanal uyumlu.');
    if(cont()&&p.driver&&p.motor&&p.driver.maxOutAperCh<p.motor.surgeA)
      add('Motorlara akım veriliyor...',false,p.driver.name+' kanal başına ~'+p.driver.maxOutAperCh+'A verebilir; '+p.motor.typeName+' kalkışta ~'+p.motor.surgeA+'A çekiyor. Sürücü kilitlenip ısınıyor.');
    else if(cont()) add('Motorlara akım veriliyor...',true,'Sürücü motor akımını karşılıyor.');
    if(cont()&&p.battery&&p.motor&&(p.motor.surgeA*qc.motor)>p.battery.dischargeA+0.1)
      add('Kalkış deneniyor...',false,p.battery.name+' anlık ~'+p.battery.dischargeA+'A verir; '+qc.motor+' motor kalkışta ~'+(Math.round(p.motor.surgeA*qc.motor*10)/10)+'A ister. Voltaj çöküyor, robot resetliyor.');
    else if(cont()) add('Kalkış deneniyor...',true,'Batarya kalkış akımını veriyor.');
    if(cont()&&p.brain&&p.sensor){ const need5=(p.sensor.logicVmin===5);
      if(need5&&p.brain.logicV<5) add('Sensör okunuyor...',false,p.sensor.name+' 5V mantıkla çalışır; '+p.brain.name+' pinleri '+p.brain.logicV+'V. Seviye uyumsuz - veri bozuk, pin riskli.');
      else add('Sensör okunuyor...',true,p.sensor.name+' beyinle konuşuyor.'); }
    if(cont()&&p.wheel&&p.sensor&&p.wheel.diaMM>=60)
      add('Çizgiye bakılıyor...',false,p.wheel.diaMM+'mm tekerlek şasiyi yükseltti; '+p.sensor.name+' zemini bulanık görüp çizgiyi kaybediyor.');
    else if(cont()) add('Çizgiye bakılıyor...',true,'Sensör zemini net görüyor.');
    if(cont()){ const rep=computeReport(build); add('Hız ölçülüyor...',true,'Ölçülen tepe hız ~'+rep.topSpeedKmh+' km/s.'); }
    const pass=steps.every(s=>s.ok); const rep=computeReport(build); const notes=[];
    if(pass){ const cpu=p.brain?p.brain.cpu:5;
      if(p.motor&&p.motor.rpm>=4000&&cpu<=2) notes.push('Beyin ('+p.brain.name+') bu kadar hızlı motorun PID döngüsünü yetiştiremeyebilir - robot geç tepki verip virajda savrulabilir.');
      if(p.sensor&&p.sensor.digital1&&p.motor&&p.motor.rpm>=3000) notes.push(p.sensor.name+' sadece aç/kapa (0/1) okur; yüksek hızda pürüzsüz PID zor, viraj geç algılanır.');
      if(p.sensor&&p.sensor.analog&&cpu<=2) notes.push(p.sensor.name+' analog; eski 8-bit beyin 8 kanalı okurken yavaşlar, PID gecikir.');
      if(rep.topSpeed<0.8) notes.push('Robot çalışıyor ama yavaş - daha yüksek RPM ya da büyük tekerlek dene.');
      if(rep.topSpeed>3.2&&rep.grip<5) notes.push('Çok hızlı ama tutuş düşük - virajda savrulabilir.');
      if(rep.weightG>380) notes.push('Robot ağır ('+rep.weightG+'g) - hızlanması ve dönüşü hantal olabilir.');
      if(rep.batteryMin&&rep.batteryMin<8) notes.push('Çalışma süresi kısa (~'+rep.batteryMin+' dk) - agresif testte pil çabuk biter.');
    }
    return {pass:pass,steps:steps,report:pass?rep:null,fullReport:rep,notes:notes};
  }

  function faultCode(steps){ const fi=steps.findIndex(s=>!s.ok); if(fi<0) return null; const l=steps[fi].label;
    if(/Sürücüye güç|akım|Kalkış/i.test(l)) return 'stall';
    if(/Sensör okunuyor|Çizgiye/i.test(l)) return 'blind';
    return 'dead'; }
  function toSimParams(build){
    const p=parts(build),rep=computeReport(build),pre=runPreTest(build);
    let vMax=2.0+(rep.topSpeed||1)*1.05; vMax=Math.max(1.8,Math.min(6.2,vMax));
    let turnGain=0.8+(p.wheel?p.wheel.grip:5)/10*0.7;
    turnGain*=Math.max(0.82,Math.min(1.08,1-(rep.weightG-220)/2200));
    turnGain=Math.max(0.75,Math.min(1.55,turnGain));
    const wheelBase=(build&&build.chassis&&build.chassis.widthU)?Math.max(0.8,Math.min(1.5,build.chassis.widthU)):1.1;
    let sensorQ=p.sensor?p.sensor.quality:0.7;
    if(p.sensor&&p.sensor.analog&&p.brain&&p.brain.cpu<=2) sensorQ*=0.8;
    const fail=pre.steps.find(s=>!s.ok);
    return {vMax:+vMax.toFixed(2),turnGain:+turnGain.toFixed(2),wheelBase:wheelBase,
      sensorQ:+sensorQ.toFixed(2),fault:fail?faultCode(pre.steps):null,faultMsg:fail?fail.msg:null};
  }
  function starterBuild(){ return {}; }


  // ---------- gamification layer (Line Follower gamification report) ----------
  // coefficient order: [h, s, d, k, b, p] (+ [6]=tork for motors)
  const GX = {
    brain:{ uno:[1,2,3,4,3,3], nano:[1,2,2,3,4,4], esp32:[4,3,2,1,3,-2], stm32:[5,4,4,0,3,2] },
    driver:{ l293d:[-3,-3,-2,5,5,-2], vnh5019:[3,4,5,1,-4,4], tb6612:[3,3,3,4,2,5], drv8833:[2,3,3,3,3,4] },
    motor:{ 'tt@250':[-2,-2,-3,5,5,3,3], 'n20@3000':[3,3,2,3,2,2,2], 'n20@5000':[5,-2,-2,1,2,-3,1],
            'm370@2000':[2,1,4,2,3,-1,8], 'm370@4000':[4,-1,3,1,2,-3,5], 'm370@5000':[4,-1,3,1,2,-3,5],
            'coreless@2000':[4,2,-1,1,-3,-2,6] },
    wheel:{ w20:[-2,5,4,1,1,2], w32:[1,4,3,2,2,3], w65:[3,-3,2,4,4,-2] },
    caster:{ cmetal:[1,2,5,2,3,2], cplastik:[1,1,1,3,4,1] },
    battery:{ aa4:[-2,-3,4,5,5,-3], lipo2s:[4,3,2,2,3,1], li18650:[1,1,5,3,3,5], lipo3s:[5,-1,-4,1,1,2] },
    sensor:{ qtr8rc:[3,4,4,3,1,3], qtr8a:[3,3,4,2,1,2], tcrt5000:[-2,-2,3,4,4,1] }
  };
  const REF_COUNTS={brain:1,driver:1,motor:2,wheel:2,caster:1,battery:1,sensor:1};
  // Yerlestirilen adet sayilari puanlara isler. Tavanlar bu yuzden teorik maksimumdan
  // degil, "makul referans" kurulumdan hesaplanir (2 motor + 2 tekerlek dahil).
  const G_CAPS=(function(){ const AX=['h','s','d','k','b','p'], caps={};
    AX.forEach(function(ax,i){ let t=0;
      ORDER.forEach(function(cat){ const ref=REF_COUNTS[cat]||0, tbl=GX[cat]; if(!ref||!tbl) return;
        let best=-1e9; Object.keys(tbl).forEach(function(k){ if(tbl[k][i]>best) best=tbl[k][i]; });
        t+=best*ref; });
      caps[ax]=t; }); return caps; })();
  function counts(build){ build=build||{}; const c=build.counts||{}, o={};
    ORDER.forEach(function(k){ o[k]=(typeof c[k]==='number')?Math.max(0,Math.round(c[k])):(build[k]?(REF_COUNTS[k]||1):0); });
    return o; }
  // Esikler: rapordaki degerler ulasilamazdi (max agirlik 395g, max tork orani 4.47).
  // Adet sayilari puanlara islediginden yeniden kalibre edildi (referans kurulum, 8064 build):
  // Tank %2.7, Guc Kulesi %2.7, APEX %0.35.
  const G_TH={tankW:350, torkRatio:7.2, apexH:0.74, apexS:0.74};
  const G_LABEL={h:'Hız',s:'Stabilite',d:'Dayanıklılık',k:'Kolaylık',b:'Bütçe',p:'Verim'};
  const G_AXES=['h','s','d','k','b','p'];
  const IDENT={
    brain:{ uno:['👴','Yavaş ama kararlı, her fırtınaya göğüs gerer.'], nano:['🐜','Küçük gövde, standart güç.'],
      esp32:['📡','Hızlı düşünür ama enerjiyi hunharca tüketir.'], stm32:['⚡','Ham işlem gücü ve hata toleransı neredeyse sıfır.'] },
    driver:{ l293d:['🐌','Ucuz ve kolay ama gücü kısıtlı, ağır motorlarla anlaşamaz.'],
      vnh5019:['🏋️','Profesyonel lig gücü pahalı ama sınır tanımaz.'],
      tb6612:['🛣️','Hafif, verimli, ısınmaz, dengeli.'], drv8833:['🛡️','Düşük voltajda sessiz ve güvenilir.'] },
    motor:{ tt:['👶','Eğitimin sadık dostu; hızı az ama asla yorulmaz.'],
      n20:['🏎️',"3000 RPM'de dengeli, 5000 RPM'de kontrolsüz bir hız canavarı."],
      m370:['💪','Devri arttıkça güçlenir ama akım iştahı da o kadar büyür.'],
      coreless:['🌪️','Hafif ve çevik; narin gövdesi aşırı zorlanmayı affetmez.'] },
    wheel:{ w20:['🩰','Hassas tutuş, düşük hız; cerrahi virajlar için.'], w32:['⚖️','Çoğu zaman doğru seçim: dengeli tutuş ve hız.'],
      w65:['🪵','Şasiyi yükseltir ama sensörü köreltebilir.'] },
    caster:{ cmetal:['🧭','Ağır ama yönü milimetrik korur.'], cplastik:['🪶','Hafif, ucuz, az sürtünme.'] },
    battery:{ aa4:['🔋','Güvenli ama akım istendiği an nefesi kesilir.'], lipo2s:['⚡','Hız ve güvenlik arasında iyi bir denge.'],
      li18650:['🏃','Bitmeyen kapasite ama ağır bir yük.'], lipo3s:['☠️','Maksimum güç; ama dikkat, yanlış sürücüyle eşleşirse felaket.'] },
    sensor:{ qtr8rc:['👁️','Net okur ama hızlı işlemci ister.'], qtr8a:['🔍','Detaylı okur ama yavaş kartlarda işlemciyi zorlar.'],
      tcrt5000:['🌫️','Ucuz ama yüksek hızda kör kalır.'] }
  };
  const ARCHETYPES={
    tank:{name:'Tank Sürüşü',emoji:'🚜',desc:'Çok ağır ve sağlam parçalar seçtin. Robotun şasisi sarsılmaz bir kale gibi ancak bu kütleyi hareket ettirmek için motorların canı çıkacak!'},
    apex:{name:'APEX: Rekabetin Zirvesi',emoji:'🐆',desc:'Yol tutuşu ve sensör kararlılığı mükemmel. Sarsıntısız, akıcı ve tutarlı bir sürüş dinamiği yakaladın.'},
    power:{name:'Güç Kulesi',emoji:'🛡️',desc:'Muazzam bir çekiş gücü! Rampaları ve engelleri aşmak onun için çocuk oyuncağı. Düz yolda ise bu tork gücü biraz fazla kaçabilir.'},
    bolt:{name:'Yıldırım Sürüşü',emoji:'🏎️',desc:'Yüksek hızlı ama ağırlığı düşük bir yapı kurdun. Düzlüklerde pistin tozunu yutturur ama keskin virajlara geldiğinde çizginin dışına savrulma riski taşır!'},
    tiger:{name:'Kayan Kaplan',emoji:'🐅',desc:'Çizgiden bir milimetre sapmıyorsun ama hız düşük kaldığı için bu henüz rekabetin zirvesi değil; güvenilir ve kararlı bir sürüş.'},
    master:{name:'Kontrol Ustası',emoji:'🧩',desc:'Manevra kabiliyeti kusursuz. Robot çizgiden bir milimetre bile sapmıyor ama bu hassasiyeti yakalamak için hızından feragat ettin.'},
    marathon:{name:'Maratoncu Ruhu',emoji:'🔋',desc:'Enerji tasarrufu tavan yaptı! Bitmeyen bir batarya ömrün var ancak pillerin getirdiği ekstra ağırlık yüzünden hızlanman zor olacak.'},
    economy:{name:'Ekonomik Kahraman',emoji:'💰',desc:'Az bütçeyle çok iş başardın. Şampiyonluğa adım adım giderken hesaplı mühendisliğin en iyi örneğisin.'}
  };
  function ident(cat,sel){
    if(cat==='motor'){ const o=opt('motor',sel); const e=o&&IDENT.motor[o.typeId]; return e?{emoji:e[0],slogan:e[1]}:null; }
    const id=(sel&&sel.id)||sel; const e=IDENT[cat]&&IDENT[cat][id];
    return e?{emoji:e[0],slogan:e[1]}:null;
  }
  function gkey(cat,sel){ if(cat==='motor'){ const o=opt('motor',sel); return o?(o.typeId+'@'+o.rpm):null; } return (sel&&sel.id)||sel; }
  function gscore(build){
    build=build||{}; const sum={h:0,s:0,d:0,k:0,b:0,p:0}; let tork=0;
    const q=counts(build);
    ORDER.forEach(cat=>{ const sel=build[cat]; if(!sel) return; const m=q[cat]||0; if(!m) return;
      const key=gkey(cat,sel); const v=GX[cat]&&GX[cat][key]; if(!v) return;
      sum.h+=v[0]*m; sum.s+=v[1]*m; sum.d+=v[2]*m; sum.k+=v[3]*m; sum.b+=v[4]*m; sum.p+=v[5]*m;
      if(cat==='motor'&&v.length>6) tork+=v[6]*m;
    });
    const weightG=computeReport(build).weightG;
    const n={}; ['h','s','d','k','b','p'].forEach(function(ax){ n[ax]=Math.min(1,sum[ax]/G_CAPS[ax]); });
    n.kd=(n.k+n.d)/2;
    return {raw:sum,tork:tork,weightG:weightG,n:n,torkRatio:weightG?(tork/weightG)*100:0};
  }
  function archetype(build){
    const g=gscore(build);
    const wrap=(id)=>Object.assign({id:id},ARCHETYPES[id],{g:g});
    if(g.weightG>=G_TH.tankW) return wrap('tank');
    if(g.n.s>=G_TH.apexS && g.n.h>=G_TH.apexH) return wrap('apex');
    if(g.torkRatio>=G_TH.torkRatio) return wrap('power');
    const pool=[['bolt',g.n.h],['tiger',g.n.s],['master',g.n.kd],['marathon',g.n.p],['economy',g.n.b]];
    let best=pool[0]; for(const c of pool) if(c[1]>best[1]+1e-9) best=c;
    return wrap(best[0]);
  }

  const API={COMPONENTS,ORDER,RATING_KEYS,RATING_LABEL,G_CAPS,G_LABEL,G_AXES,G_TH,REF_COUNTS,ARCHETYPES,IDENT,counts,opt,motorType,parts,ratings,ident,gscore,archetype,computeReport,runPreTest,toSimParams,starterBuild};
  global.RobotData=API;
  if(typeof module!=='undefined'&&module.exports) module.exports=API;
})(typeof window!=='undefined'?window:globalThis);
