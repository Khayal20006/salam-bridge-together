# Açıq Slither müştərisinə baxış

2026-11-03 tarixində [rəsmi açıq JavaScript müştərisi](https://slither.io/s/game1107249518.js)
oxunub. Bu, brauzer kodudur; gizli server kodu və server toqquşma qaydaları deyil.

Müşahidələr:

- Çəkiliş brauzerin animasiya kadrları ilə idarə edilir.
- Düzəlişlər üçün əvvəlcədən ayrılmış ədədi buferlər istifadə olunur.
- Bədən nöqtələrinin mövqe fərqləri ayrıca və zaman boyunca yumşaldılır.
- Başın istiqaməti və bədən mövqeləri ayrıca emal olunur.

Bizim tətbiqdə uyğun məqsəd: fiziki ortaq vəziyyəti saxlayıb görünən baş və hər
bədən nöqtəsinin düzəlişini yumşaltmaq. Əlavə render nöqtələri serverə göndərilmir.
Üçüncü tərəfin kodu və şəkilləri oyun deposuna köçürülməyib; həll öz kodumuzdur.

## Digər açıq müştərilərlə müqayisə

[Wormax açıq brauzer müştərisi](https://wormax.io/SnakeGame/DF7C3A1055D18871B1289C4FD439D106.cache.js):
baş istiqaməti və görünən radius zamanla yumşaldılır. Boyun üçün başın
istiqamətində köməkçi nöqtə qurulur, əyri bədənə bağlanır. Bədən keçmiş və
növbəti addım mövqeləri arasında hesablanır; çəkiliş nöqtələri təkrar istifadə
olunur. Bu müşahidələr serverin gizli fizikasını və tick tezliyini təsdiqləmir.

[Wormate açıq müştərisi](https://wormate.io/js/game.js?v=1ba5f2f) qismən oxunub:
çəkiliş requestAnimationFrame ilə çağırılır. Obfuskasiya səbəbindən bu baxışda
onun boyun və şəbəkə düzəlişi mexanizmi tam təsdiqlənməyib.
[Wormzilla](https://wormzilla.io/) birbaşa sorğuya HTTP 403 qaytarıb;
onun hərəkət kodu təhlil edilmiş sayılmır.

Bizdə 2026.11.03.6: başdan ilk bədən nöqtəsinə əyri başlanğıc istiqaməti ilə
bağlanır, gözlər həmin görünən əyri boyunca yönəlir. Kursor başın üstündə olanda
xırda mövqe fərqi qəfil dönmə yaratmır. Fiziki nöqtələr və ortaq bot vəziyyəti
bu çəkiliş dəyişikliyindən dəyişmir. Baş-boyun istiqaməti üçün regresiya testi var.
