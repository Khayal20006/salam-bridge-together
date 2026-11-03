# Promtlardakı tələblərin yoxlanması

Tarix: 2026-11-03. Salamlaşma və status sorğuları proqram tələbi sayılmır.
Bir tələb sonradan dəyişdirilibsə, son göstəriş əsas götürülüb. Ən son göstəriş:
ilan həm hiss edilən şəkildə uzansın, həm də azca qalınlaşsın.

| İstək                                                                   | Vəziyyət                        | Yoxlama və sərhəd                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eyni otaqda hamıya eyni botlar, yemlər və ölümlər                       | Lokal və real relay-də yoxlanıb | İki real Edge səhifəsində həqiqi Supabase bağlantısı ilə bütün dünya kadrları eyni tick üzrə müqayisə edilib. Real WebSocket müştəriləri də eyni botları və yemləri alır.                                                                                                    |
| Hər brauzerdə ayrıca dünya yaranmasın                                   | Yoxlanıb                        | Bir idarəedici simulyasiya var. Digərləri yalnız idarəetmə göndərir. İdarəedici də digərləri ilə eyni kvantlaşdırılmış kadrı göstərir.                                                                                                                                       |
| Başqasının içində doğulma olmasın                                       | Yoxlanıb                        | Yeni ilanın bütün bədəni sərhəddən və mövcud bədənlərdən aralı yerləşdirilir. Təhlükəsiz yer yoxdursa doğulma rədd edilir.                                                                                                                                                   |
| Doğulanda qoruma olsun                                                  | Yoxlanıb                        | 45 tick = 1500 ms. Qorunan ilan təmasdan ölmür və bədəni başqasını öldürmür. Təkrar join qorumanı uzatmır; sərhəd qüvvədə qalır. Qoruma başın ətrafında halqa ilə göstərilir.                                                                                                |
| Qoruma bitəndə bədənə dəyən oyunçu ölsün                                | Yoxlanıb                        | Bitmə tick-i və toxunan kənar üçün ayrıca test var. Başın toqquşma radiusu görünən və böyüyən bədən radiusuna uyğunlaşdırılıb.                                                                                                                                               |
| Baş-başa toqquşmada bir qalib qalsın                                    | Yoxlanıb                        | Böyük ilan qalibdir; bərabərlikdə sabit ID qaydası var. Daxiletmə sırası nəticəni dəyişmir. Qalib ayrıca başqa bədənə dəyərsə yenə ölə bilər.                                                                                                                                |
| Sürətlə hərəkətdə bədəndən keçmə olmasın                                | Yoxlanıb                        | Addım boyunca keçilən baş yolu bədən seqmentləri ilə müqayisə edilir. Boost və kənar təması test edilir.                                                                                                                                                                     |
| Baş yumşaq dönsün, bədən və quyruq döngəni izləsin                      | Davranış yoxlanıb               | Bədən başın keçdiyi yolu məsafə ilə izləyir; dönmə yumşaldılır, əyrilər fasiləsiz çəkilir. Döngənin quyruğa çatması üçün test var. Vizual zövq subyektivdir.                                                                                                                 |
| Botlar yerində dövrə vurmasın                                           | Yoxlanıb                        | Qabaqdakı yem hədəfi saxlanır, gələcək qısa yollar maneələrlə müqayisə edilir, irəliləməyən hədəfdən çıxılır. 10 saniyəlik sabit toxumlu sınaqda 18 botun hər biri başlanğıcdan ən az 515 vahid uzaqlaşıb.                                                                   |
| Həm uzansın, həm azca qalınlaşsın                                       | Yoxlanıb                        | Normal yem 0,6 uzunluq əlavə edir; radius uzunluğa görə tədricən 11-dən maksimum 18-ə artır. Artım yeni keçilmiş yol hesabına bədənə yayılır.                                                                                                                                |
| Yemlər ağıza çəkilsin                                                   | Yoxlanıb                        | Bir yem üçün bir ən yaxın ağız seçilir. Yemin hərəkəti şəbəkəyə göndərilir. Yaxın, uzaq və iki ilan arasında qalan yem test edilir.                                                                                                                                          |
| Arxa plana keçən vərəq oyunu dondurmasın                                | İki brauzerdə yoxlanıb          | Simulyasiya Web Worker-dədir, görünən vərəq üstün idarəedici seçilir. Arxa plana keçmə və idarəedicinin bağlanmasında dünya saxlanır. Bütün vərəqləri əməliyyat sistemi dayandırsa brauzer ehtiyat rejimi fasiləsiz server ola bilməz.                                       |
| Paket itəndə dünya bərpa olunsun                                        | Yoxlanıb                        | İtmiş baza kadrı tam kadr sorğusu ilə bərpa edilir. Eyni tick-də dəyişən tam kadr qəbul olunur; səssiz axına nəzarət var.                                                                                                                                                    |
| Server yükü və donma azalsın                                            | Lokal ölçülüb                   | Məkan şəbəkəsi, 30 Hz simulyasiya, 10 Hz yayım və məhdud göndərmə növbəsi var. Dəyişməyən idarəetmə 5 Hz, dönmə ən çox 20 Hz göndərilir. Son benchmark: orta 49,2 insan + 18 bot; p95 6,22 ms, tick büdcəsi 33,33 ms. Bu, istehsalda internet və 50 brauzer yük testi deyil. |
| Skinlər yaxşılaşdırılsın                                                | Əlavə olunub                    | Aurora, Obsidian, Sakura və Royal əlavə olunub. Bütün rəqib oyunlardan üstün görünməsi obyektiv təsdiqlənə bilməz.                                                                                                                                                           |
| Mövcud lokal fayllarla işlənilsin, əvvəlki versiya ilə müqayisə olunsun | Yerinə yetirilib                | Yeni Git klonu yaradılmayıb. Əvvəlki lokal SnakeGame dəyişikliyi yeniləmədən əvvəl Git stash-də saxlanılıb.                                                                                                                                                                  |
| Ərazinin ölçüsü                                                         | Dəyişdirilməyib                 | Əvvəlki b9ad74b və indiki versiyada radius 3000, diametr 6000-dir.                                                                                                                                                                                                           |
| Lokal link və yeni versiya verilsin                                     | Hazırdır                        | http://127.0.0.1:8080/ əsas C:\salam-bridge-together-main qovluğundan başladılır. Qrafika panelində versiya 2026.11.03.4-dür.                                                                                                                                                |
| Commit və push edilsin                                                  | Bağlantı işləyir, push yoxlanır | main yenilənir və uzaq branch SHA-sı yoxlanır. Yayımlanmış tarix yenidən yazılmır.                                                                                                                                                                                           |
| Yeniliklər neonworm.app-da işləsin                                      | Açıq qalıb                      | Son yoxlamada sayt b9ad74b40c010489b08af0dfa191d7a7fe4d7742 göstərirdi. Lovable-da yenilənmiş layihəni Publish → Update etmək lazımdır. GitHub push-u canlı yayımın sübutu deyil.                                                                                            |
| Ayrılmış və regional oyun serverləri işləsin                            | Canlıda təsdiqlənməyib          | Node WebSocket serveri hazırlanıb, lokal yoxlanıb. Ayrı xidmətin yayımlanması və VITE_ARENA_URL konfiqurasiyası lazımdır. Region adları həqiqi coğrafi server yerləşdirilməsi deyil.                                                                                         |
| Heç bir bug və sıfır gecikmə olsun                                      | Təsdiqlənməyib                  | Aşkarlanan xətalar konkret testlərlə yoxlanır. Bütün mümkün xətaların yoxluğu və internetdə sıfır gecikmə zəmanəti verilmir.                                                                                                                                                 |

68 avtomatik test, TypeScript, ESLint, production build, real WebSocket və real
Supabase brauzer sınaqları keçirilib. Brauzer ehtiyat rejimi etibarlı ayrılmış
serverin təhlükəsizlik zəmanətlərini vermir. Logo və bütün skinlərin vizual
keyfiyyətinin insan tərəfindən tam qiymətləndirilməsi ayrıca açıq qalır.

Son yenilik: canlı sayt 70becd2 commit-i və 2026.11.03.2 versiyası ilə real brauzerdə
açılıb, oyuna qoşulma və doğulma qorumasının görüntüsü yoxlanıb. Yuxarıdakı b9ad74b
barədə qeyd əvvəlki yoxlamanın nəticəsidir. 2026.11.03.3 yaddaş optimallaşdırması
ayrıca yayımlanmalıdır. Eyni kadr üçün indekslər təkrar qurulmur, dəyişməyən yem
obyektləri və dəyişməz bədən yolları paylaşılır. Əvvəlki kadrların pozulmadığı üçün
yeni testlər var. Ölçmələr docs/MULTIPLAYER.md-də qeyd edilib.

2026.11.03.4: əvvəlki hərəkətlə müqayisə aparıldı. Yalnız lokal ilanın görünən
hərəkəti dərhal proqnozlaşdırılır və ortaq vəziyyətlə yumşaq düzəlir. Botlar, yemək,
uzunluq və ölüm qərarları ortaq qalır. İdarəetmə ack-ləri göndərilir; köhnə serverdə
proqnoz söndürülür. 65 test və real brauzerdə 1 saniyədə 61 proqnoz kadrı yoxlanıb.
İki real brauzerdə eyni botlar və host dəyişməsi yoxlanıb. Ayrıca oyun serverinin
olmadığı istifadəçi tərəfindən təsdiqlənib; yalnız Lovable ilə brauzer hostunun
gecikməsi və dayandırılması tam aradan qalxmır.

2026.11.03.5: daha sıx bədən (10 yerinə 37 çəkiliş nöqtəsi), paket gələn kadrdakı
dayanma və quyruğun yana sıçraması üçün regresiya testləri əlavə edildi. Yüngül
kənar təmas üçün toqquşma radiusu 80%-ə endirildi; normal yem 0,75 uzunluq verir.
Tab keçidində dayanmama, hostun checkpoint ilə ötürülməsi və səhifəni yeniləyən
oyunçunun eyni dünyaya qoşulması real Supabase bağlantısında yoxlanır.
