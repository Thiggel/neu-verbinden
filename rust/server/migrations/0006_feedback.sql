-- Bug reports and wishes, kept as well as sent.
--
-- Mail can fail: a wrong password, a provider refusing, nobody having
-- configured SMTP at all. Somebody who took the trouble to write should not
-- lose what they wrote to a misconfiguration nobody noticed, so the row is
-- written first and the mail attempted afterwards.
CREATE TABLE IF NOT EXISTS feedback (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind       text NOT NULL,
    message    text NOT NULL,
    -- Whatever the sender chose to leave, if anything. Never required: the
    -- promise of this service is that it works without an address.
    reply_to   text,
    -- The page it was sent from, which is most of the context a bug report needs.
    page       text NOT NULL DEFAULT '',
    user_agent text NOT NULL DEFAULT '',
    author_id  uuid REFERENCES users (id) ON DELETE SET NULL,
    mailed_at  timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT feedback_kind CHECK (kind IN ('fehler', 'wunsch', 'sonstiges')),
    CONSTRAINT feedback_length CHECK (length(btrim(message)) BETWEEN 5 AND 4000)
);

CREATE INDEX IF NOT EXISTS feedback_recent ON feedback (created_at DESC);
