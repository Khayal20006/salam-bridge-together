CREATE TABLE public.skin_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  skin_id text NOT NULL,
  environment text NOT NULL DEFAULT 'sandbox',
  transaction_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.skin_purchases TO authenticated;
GRANT ALL ON public.skin_purchases TO service_role;
ALTER TABLE public.skin_purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own purchases" ON public.skin_purchases FOR SELECT TO authenticated USING (auth.uid() = user_id);