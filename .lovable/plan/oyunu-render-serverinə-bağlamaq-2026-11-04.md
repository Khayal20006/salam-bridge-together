# Oyunu Render serverinə bağlamaq

## Nə edəcəyik
- Canlı sayt (neonworm.app) oyunçuları Render-dəki oyun serverinə qoşacaq. Artıq heç kimin kompüteri server rolunu oynamayacaq.
- Render-in səhifə ünvanlarına (neonworm.app, www.neonworm.app, lovable.app) icazə artıq var.

## Addımlar
1. `.env.production` faylına `VITE_ARENA_URL=https://salam-bridge-together.onrender.com/arena` sətrini əlavə etmək (köhnə ödəniş sətri yerində qalır, ayrıca sətirdə).
2. Testləri işə salıb yoxlamaq ki, heç nə pozulmayıb.
3. Render serverinə canlı saytın ünvanı ilə bağlantı yoxlaması etmək.
4. Dəyişiklik avtomatik GitHub-a gedəcək; sonra siz "Publish" basırsınız.

## Qeyd
- Render-in pulsuz planında server 15 dəqiqə boş qalanda yatır; ilk girişdə 20-30 saniyə "Qoşulur..." görünə bilər.
