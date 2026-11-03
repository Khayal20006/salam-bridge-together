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
