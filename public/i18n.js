// Two languages: English (default) and Persian. t('English text', {vars}) returns the Persian version when the
// player chose Persian and a translation exists, otherwise the English text. Server error messages go through t()
// too (toast), so they are listed here by their exact English wording.
export let LANG = 'en';
export const LANGS = { en: 'English', fa: 'فارسی' };

export function setLang(l) {
  LANG = l === 'fa' ? 'fa' : 'en';
  document.documentElement.lang = LANG;
  document.documentElement.dir = LANG === 'fa' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach(el => { el.innerHTML = t(el.dataset.i18n); });
}
// the language to show before the player has picked one: Telegram's app language
export const guessLang = code => (/^fa\b/i.test(code ?? '') ? 'fa' : 'en');

export function t(s, vars) {
  let r = (LANG === 'fa' && FA[s]) || s;
  if (vars) r = r.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  return r;
}

const FA = {
  // shell
  Games: 'بازی‌ها', Wallet: 'کیف پول', History: 'تاریخچه', Profile: 'پروفایل',
  'Mines, Penalty and Higher or Lower.<br>Fast. Fair. Exciting.': 'ماینز، پنالتی و بالاتر یا پایین‌تر.<br>سریع، منصفانه، هیجان‌انگیز.',
  'YOUR FAVOURITE<br>GAMES, <span>NOW IN TELEGRAM</span>': 'بازی‌های محبوبت،<br><span>حالا در تلگرام</span>',
  'Mines · Penalty · Higher or Lower<br>These games run inside Telegram.': 'ماینز · پنالتی · بالاتر یا پایین‌تر<br>این بازی‌ها داخل تلگرام اجرا می‌شوند.',
  'Open in Telegram': 'باز کردن در تلگرام',
  'START PLAYING': 'شروع بازی',
  'Choose your language': 'زبان خود را انتخاب کنید',
  Language: 'زبان',
  'Try again': 'دوباره امتحان کن',

  // games
  Mines: 'ماینز', Penalty: 'پنالتی', 'Higher or Lower': 'بالاتر یا پایین‌تر',
  'Find safe tiles. Avoid the mines.': 'خانه‌های امن را پیدا کن، از مین دوری کن.',
  'Pick a corner. Beat the keeper.': 'یک گوشه را انتخاب کن، دروازه‌بان را شکست بده.',
  'Will the next card be higher or lower?': 'کارت بعدی بالاتر است یا پایین‌تر؟',
  'Risk & Strategy': 'ریسک و استراتژی', Football: 'فوتبال', Cards: 'کارتی',
  '10k coins': '۱۰ هزار سکه',
  'Mines — 3×3 board, 2 bombs. Each safe tile raises the multiplier; cash out any time.': 'ماینز: صفحه‌ی ۳ در ۳ با ۲ مین. هر خانه‌ی امن ضریب را بالا می‌برد و هر وقت خواستی برداشت می‌کنی.',
  'Penalty — up to 5 shots; the keeper saves 1 corner in 5. Each goal raises the multiplier; cash out any time.': 'پنالتی: تا ۵ ضربه؛ دروازه‌بان از هر ۵ گوشه یکی را می‌گیرد. هر گل ضریب را بالا می‌برد و هر وقت خواستی برداشت می‌کنی.',
  'Higher or Lower — guess the next card; a same rank wins both ways. Each right guess multiplies; cash out any time.': 'بالاتر یا پایین‌تر: کارت بعدی را حدس بزن؛ کارت مساوی در هر دو حالت برد است. هر حدس درست ضریب را بالا می‌برد و هر وقت خواستی برداشت می‌کنی.',

  // home
  'Good morning': 'صبح بخیر', 'Good afternoon': 'ظهر بخیر', 'Good evening': 'عصر بخیر', Player: 'بازیکن',
  'Out of coins?': 'سکه‌ات تمام شده؟', "Here's {n}<br>to keep playing": '{n} سکه هدیه<br>برای ادامه‌ی بازی', 'Get +{n}': 'دریافت +{n}',
  'Daily reward · day {d} of 7': 'جایزه‌ی روزانه · روز {d} از ۷', 'Free coins<br>every day': 'سکه‌ی رایگان<br>هر روز',
  'Next in {t}': 'بعدی تا {t}', 'Claim +{n}': 'دریافت +{n}', '{h}h {m}m': '{h} ساعت {m} دقیقه',
  'Invite <b>+{n}</b>': 'دعوت <b>+{n}</b>', Leaderboard: 'جدول امتیازات', 'Featured Games': 'بازی‌ها',
  'up to {m}': 'تا {m}', 'Round in play': 'دست نیمه‌تمام', Resume: 'ادامه', 'Play now': 'بازی کن',
  'Every round is provably fair.': 'نتیجه‌ی هر دست قابل بررسی و منصفانه است.', 'Lv. {n}': 'سطح {n}',

  // wallet + shop
  'Your balance': 'موجودی شما', 'Daily {t}': 'روزانه {t}', 'Invite +{n}': 'دعوت +{n}', 'Out of coins? Get +{n}': 'سکه‌ات تمام شده؟ دریافت +{n}',
  'Buy coins': 'خرید سکه', Transactions: 'تراکنش‌ها', 'Loading…': 'در حال بارگذاری…', 'No transactions yet': 'هنوز تراکنشی نیست',
  'Welcome bonus': 'هدیه‌ی خوش‌آمد', 'Daily bonus': 'جایزه‌ی روزانه', 'Invite reward': 'پاداش دعوت', 'Invited by a friend': 'دعوت از طرف دوست',
  'Rescue coins': 'سکه‌ی نجات', 'Coins purchased': 'خرید سکه', 'Purchase refunded': 'برگشت خرید',
  win: 'برد', bet: 'شرط', 'bet lowered': 'کاهش شرط', 'bal {n}': 'موجودی {n}', Game: 'بازی',
  coins: 'سکه', '+{n}% bonus': '+{n}٪ هدیه', Popular: 'محبوب', 'Best value': 'بهترین ارزش',
  'Coins are for playing inside Plus Games only. They cannot be withdrawn or exchanged for money.': 'سکه‌ها فقط برای بازی داخل پلاس گیمز هستند و قابل برداشت یا تبدیل به پول نیستند.',
  'Open Plus Games in Telegram to buy coins': 'برای خرید سکه، پلاس گیمز را داخل تلگرام باز کن',
  'Payment failed. You were not charged.': 'پرداخت ناموفق بود. مبلغی کسر نشد.',
  'Payment received. Adding your coins…': 'پرداخت انجام شد. در حال افزودن سکه‌ها…',
  '+{n} coins added': '+{n} سکه اضافه شد', 'Your coins will appear in a moment': 'سکه‌ها تا چند لحظه‌ی دیگر نمایش داده می‌شوند',
  '+{n} coins! Tomorrow: +{m}': '+{n} سکه! فردا: +{m}', '+{n} coins to get you playing again': '+{n} سکه برای ادامه‌ی بازی',
  'Invites are not available yet': 'دعوت هنوز فعال نیست', 'Invite link copied': 'لینک دعوت کپی شد',
  '🎮 Play {games} with me! You get {n} free coins.': '🎮 با من {games} بازی کن! {n} سکه‌ی رایگان می‌گیری.',

  // history
  'Game History': 'تاریخچه‌ی بازی', All: 'همه', 'No rounds yet — go play!': 'هنوز دستی بازی نکرده‌ای، شروع کن!',
  Win: 'برد', Lose: 'باخت', '{n}/5 goals': '{n}/۵ گل', '{n} right': '{n} درست', 'bet {n}': 'شرط {n}',

  // profile
  'Rounds': 'دست‌ها', 'Win rate': 'درصد برد', Net: 'سود خالص', Best: 'بهترین',
  'Invite friends · {n} joined': 'دعوت دوستان · {n} نفر', 'Provably fair': 'منصفانه و قابل بررسی', 'How to play': 'راهنمای بازی',
  "Every round's result is fixed by a secret seed <b>before</b> you play. You see its SHA-256 fingerprint up front; when the round ends the seed is revealed.":
    'نتیجه‌ی هر دست <b>قبل از</b> بازی با یک کد مخفی (seed) مشخص می‌شود. اثر انگشت SHA-256 آن را از اول می‌بینی و بعد از پایان دست، خود کد نمایش داده می‌شود.',
  'Open "Provably fair" under any game and tap <b>Verify</b>: your phone recomputes the result from the seed.':
    'در هر بازی بخش «منصفانه و قابل بررسی» را باز کن و <b>بررسی</b> را بزن: گوشی‌ات نتیجه را از روی کد دوباره حساب می‌کند.',
  'Bets are 10, 50 or 100 coins. Coins are virtual and have no cash value.': 'شرط‌ها ۱۰، ۵۰ یا ۱۰۰ سکه است. سکه‌ها مجازی‌اند و ارزش پولی ندارند.',

  // invites
  'Invite friends': 'دعوت دوستان', 'Share my link': 'اشتراک لینک من', 'Your friends': 'دوستان شما',
  'Your friend gets <b>+{w}</b> coins on top of the usual 1,000. You get <b>+{s}</b> when they join, and <b>+{a}</b> once they have played {r} rounds on {d} different days within {x} days.':
    'دوستت علاوه بر ۱٬۰۰۰ سکه‌ی همیشگی، <b>+{w}</b> سکه می‌گیرد. تو با عضو شدنش <b>+{s}</b> می‌گیری و وقتی در {x} روز اول، {r} دست در {d} روز مختلف بازی کرد، <b>+{a}</b>.',
  '+{n} earned': '+{n} دریافت شد', Expired: 'منقضی شد', '{n}/{m} rounds': '{n}/{m} دست', 'joined {t}': 'عضویت {t}',
  ' · over the monthly limit': ' · بیش از سقف ماهانه', 'No friends yet: share your link!': 'هنوز دوستی نیامده؛ لینکت را بفرست!',

  // leaderboard
  '🏆 This week': '🏆 این هفته', 'by virtual profit · resets Saturday': 'بر اساس سود مجازی · شنبه‌ها از صفر', ' (you)': ' (شما)',
  '{n} rounds': '{n} دست', 'No players yet': 'هنوز بازیکنی نیست',

  // time
  'just now': 'همین الان', '{n}m ago': '{n} دقیقه پیش', '{n}h ago': '{n} ساعت پیش',

  // shared game UI
  Bet: 'شرط', 'Current multiplier': 'ضریب فعلی', 'You won': 'بردی', 'Cash out': 'برداشت', Play: 'بازی', 'Play again': 'دوباره',
  'Not enough coins': 'سکه کافی نیست', Multiplier: 'ضریب', 'Pays ({n})': 'پرداخت ({n})', Hash: 'هش', Seed: 'کد',
  'Coins are virtual and have no cash value.': 'سکه‌ها مجازی‌اند و ارزش پولی ندارند.',
  'Verify last round': 'بررسی دست آخر',
  'The outcome is fixed by a secret seed before you play. You see its SHA-256 now; the seed is revealed after the round so you can check nothing changed.':
    'نتیجه قبل از بازی با یک کد مخفی مشخص می‌شود. هش SHA-256 آن را الان می‌بینی و بعد از پایان دست، خود کد نمایش داده می‌شود تا بررسی کنی چیزی عوض نشده.', 'Place a bet to get a round hash': 'برای دریافت هش دست، شرط ببند',
  'Choose your bet: {bets} coins.': 'مبلغ شرط را انتخاب کن: {bets} سکه.',
  '✅ Verified: seed matches its hash, {what}': '✅ تأیید شد: کد با هش می‌خواند، {what}', '❌ Mismatch!': '❌ عدم تطابق!',
  Close: 'بستن', 'Lower bet': 'کاهش شرط', 'Raise bet': 'افزایش شرط', 'Bet amount': 'مبلغ شرط',
  'BIG WIN!': 'برد بزرگ!', 'MAX WIN!': 'حداکثر برد!', 'TOP WIN!': 'برد عالی!', 'PERFECT 5/5!': 'عالی ۵ از ۵!',

  // mines
  Bomb: 'مین', Safe: 'امن', 'Tile {n}': 'خانه‌ی {n}', '{m} mines in {c} tiles': '{m} مین در {c} خانه', '{k} of {n} safe tiles': '{k} از {n} خانه‌ی امن',
  'Open a random tile': 'باز کردن یک خانه‌ی تصادفی',
  'Cashed at': 'برداشت در', 'Boom!': 'بوم!', 'Safe tiles': 'خانه‌های امن', 'Next pick': 'انتخاب بعدی', 'Pick a tile': 'یک خانه انتخاب کن',
  '{m} bombs hide among {c} tiles. Every safe tile raises the multiplier.': '{m} مین بین {c} خانه پنهان است. هر خانه‌ی امن ضریب را بالا می‌برد.',
  'Cash out any time after the first safe tile. Hit a bomb and the bet is lost.': 'بعد از اولین خانه‌ی امن هر وقت خواستی برداشت کن. اگر به مین بخوری، شرط را می‌بازی.',
  'Clear all {n} safe tiles to win the top prize automatically.': 'اگر هر {n} خانه‌ی امن را باز کنی، بالاترین جایزه خودکار پرداخت می‌شود.',
  'The bombs are placed by a secret seed <b>before</b> you play. You see its SHA-256 fingerprint now; the seed is revealed when the round ends, so you can check nothing changed.':
    'جای مین‌ها <b>قبل از</b> بازی با یک کد مخفی مشخص می‌شود. اثر انگشت SHA-256 آن را الان می‌بینی و بعد از پایان دست، خود کد نمایش داده می‌شود تا بررسی کنی چیزی عوض نشده.',

  // penalty
  Saved: 'مهار شد', Goals: 'گل‌ها', 'Next goal': 'گل بعدی', 'Tap a corner': 'یک گوشه را بزن', 'per shot': 'در هر ضربه',
  '{k} goals of {n}': '{k} گل از {n}', 'Shoot {z}': 'شوت به {z}', 'Shoot a random corner': 'شوت به یک گوشه‌ی تصادفی',
  'top left': 'بالا چپ', 'top right': 'بالا راست', middle: 'وسط', 'bottom left': 'پایین چپ', 'bottom right': 'پایین راست',
  'Goal chance 80 percent per shot': 'شانس گل در هر ضربه ۸۰ درصد',
  'GOAL!': 'گل!', 'SAVED!': 'مهار شد!',
  'Choose your bet: {bets} coins, and press Play.': 'مبلغ شرط را انتخاب کن ({bets} سکه) و «بازی» را بزن.',
  'Tap one of the {n} glowing corners to shoot. Each goal raises the multiplier.': 'یکی از {n} گوشه‌ی نورانی را بزن تا شوت کنی. هر گل ضریب را بالا می‌برد.',
  'The keeper dives to one corner per shot. Shoot where he goes and the bet is lost.': 'دروازه‌بان در هر ضربه به یک گوشه شیرجه می‌زند. اگر همان‌جا را بزنی، شرط را می‌بازی.',
  'Where you aim does not change your chances: every shot scores 4 times in 5.': 'جایی که نشانه می‌گیری شانس را عوض نمی‌کند: هر ضربه ۴ بار از ۵ بار گل می‌شود.',
  'Cash out after any goal. Five goals pay the top prize automatically.': 'بعد از هر گل می‌توانی برداشت کنی. پنج گل، بالاترین جایزه را خودکار پرداخت می‌کند.',
  "The keeper's five dives are fixed by a secret seed <b>before</b> your first shot. You see its SHA-256 fingerprint now; the seed is revealed when the round ends, so you can check nothing changed.":
    'پنج شیرجه‌ی دروازه‌بان <b>قبل از</b> اولین ضربه با یک کد مخفی مشخص می‌شود. اثر انگشت SHA-256 آن را الان می‌بینی و بعد از پایان دست، خود کد نمایش داده می‌شود.',

  // higher or lower
  'Wrong guess': 'حدس اشتباه', 'Right guesses': 'حدس‌های درست', Guesses: 'حدس‌ها', 'Make your guess': 'حدس بزن',
  Deal: 'پخش کارت', 'Deal again': 'پخش دوباره', 'Higher or same': 'بالاتر یا مساوی', 'Lower or same': 'پایین‌تر یا مساوی',
  Higher: 'بالاتر', Lower: 'پایین‌تر', Same: 'مساوی', '{n}% chance': 'شانس {n}٪', 'Skip card': 'رد کردن کارت', 'Skip card · {n} left': 'رد کردن کارت · {n} بار',
  'Ace high': 'آس بالاترین', 'Cards played': 'کارت‌های بازی‌شده', 'Cards 2 to Ace': 'کارت‌ها از ۲ تا آس', 'Deal to get a round hash': 'برای دریافت هش دست، کارت پخش کن',
  'Choose your bet: {bets} coins, and press Deal. A card is turned face up.': 'مبلغ شرط را انتخاب کن ({bets} سکه) و «پخش کارت» را بزن. یک کارت رو می‌شود.',
  'Guess whether the next card is <b>higher or same</b>, or <b>lower or same</b>. A same rank wins either way.': 'حدس بزن کارت بعدی <b>بالاتر یا مساوی</b> است یا <b>پایین‌تر یا مساوی</b>. کارت مساوی در هر دو حالت برد است.',
  '2 is the lowest card and Ace the highest; suits do not matter. On an Ace you pick "Same" or "Lower"; on a 2, "Same" or "Higher".': '۲ پایین‌ترین و آس بالاترین کارت است و خال اهمیتی ندارد. روی آس بین «مساوی» و «پایین‌تر» و روی ۲ بین «مساوی» و «بالاتر» انتخاب می‌کنی.',
  'Each button shows its chance and the multiplier you reach if right. Every right guess multiplies; a wrong one loses the bet.': 'روی هر دکمه شانس و ضریبی که با حدس درست می‌گیری نوشته شده. هر حدس درست ضریب را بالا می‌برد و حدس اشتباه شرط را از بین می‌برد.',
  'Every card is drawn from a fresh deck, so counting cards does not help. You may skip a card {n} times per round.': 'هر کارت از یک دسته‌ی تازه کشیده می‌شود، پس شمردن کارت‌ها کمکی نمی‌کند. در هر دست {n} بار می‌توانی کارت را رد کنی.',
  'Cash out after any right guess. The round ends by itself after {g} right guesses or a {c}-coin win.': 'بعد از هر حدس درست می‌توانی برداشت کنی. دست بعد از {g} حدس درست یا برد {c} سکه خودکار تمام می‌شود.',
  'Every card of the round is fixed by a secret seed <b>before</b> the first card is shown. You see its SHA-256 fingerprint now; the seed is revealed when the round ends, so you can check no card changed.':
    'همه‌ی کارت‌های دست <b>قبل از</b> نمایش اولین کارت با یک کد مخفی مشخص می‌شوند. اثر انگشت SHA-256 آن را الان می‌بینی و بعد از پایان دست، خود کد نمایش داده می‌شود.',

  // server and network messages
  'Connection lost — check your network': 'اتصال قطع شد، اینترنت را بررسی کن', 'Something went wrong': 'مشکلی پیش آمد',
  'Server error, try again': 'خطای سرور، دوباره امتحان کن', 'Open the game from Telegram': 'بازی را از داخل تلگرام باز کن',
  'Not enough coins': 'سکه کافی نیست', 'No active round': 'دست فعالی وجود ندارد', 'Round already finished': 'این دست تمام شده است',
  'Bet must be 10, 50 or 100': 'شرط باید ۱۰، ۵۰ یا ۱۰۰ باشد', 'Slow down a little': 'کمی آهسته‌تر',
  'Finish your round first': 'اول دست فعلی را تمام کن', 'Finish your Mines round first': 'اول دست ماینز را تمام کن',
  'Finish your Penalty round first': 'اول دست پنالتی را تمام کن', 'Finish your Higher or Lower round first': 'اول دست بالاتر یا پایین‌تر را تمام کن',
  'Open at least one tile first': 'اول حداقل یک خانه را باز کن', 'Score at least one goal first': 'اول حداقل یک گل بزن',
  'Make at least one right guess first': 'اول حداقل یک حدس درست بزن', 'No skips left this round': 'در این دست دیگر نمی‌توانی کارت رد کنی',
  'Pick a corner': 'یک گوشه انتخاب کن', 'Daily bonus already claimed': 'جایزه‌ی امروز را گرفته‌ای',
  'You still have coins to play': 'هنوز سکه برای بازی داری', 'Rescue coins are not ready yet': 'سکه‌ی نجات هنوز آماده نیست',
  'Payment is unavailable right now, try again': 'پرداخت فعلاً در دسترس نیست، دوباره امتحان کن', 'Unknown coin pack': 'بسته‌ی سکه نامعتبر است',
};
