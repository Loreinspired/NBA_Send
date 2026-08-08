-- Dev/local-only seed data: one branch, three sender profiles, ten members
-- spanning every audience-segment combination. Lets the whole stack be
-- exercised end-to-end with zero live Sheets/Sendchamp credentials.
SET app.current_branch_id = 'ALL';

INSERT INTO branches (id, slug, name, sms_sender_id, timezone)
VALUES (
    '11111111-1111-1111-1111-111111111111',
    'ado-ekiti',
    'NBA Ado-Ekiti Branch',
    'NBA-ADO',
    'Africa/Lagos'
);

INSERT INTO sender_profiles (branch_id, role, display_name, signature_block, contact_phone, contact_email)
VALUES
    (
        '11111111-1111-1111-1111-111111111111',
        'pro',
        'Barr. Adeola Fashola, Public Relations Officer',
        E'\n\n— Barr. Adeola Fashola\nPublic Relations Officer, NBA Ado-Ekiti Branch\n0803 000 0001 | pro@nba-adoekiti.org',
        '+2348030000001',
        'pro@nba-adoekiti.org'
    ),
    (
        '11111111-1111-1111-1111-111111111111',
        'branch_chairman',
        'Barr. Chukwuemeka Okafor, Branch Chairman',
        E'\n\n— Barr. Chukwuemeka Okafor\nChairman, NBA Ado-Ekiti Branch\n0803 000 0002 | chairman@nba-adoekiti.org',
        '+2348030000002',
        'chairman@nba-adoekiti.org'
    ),
    (
        '11111111-1111-1111-1111-111111111111',
        'secretariat',
        'NBA Ado-Ekiti Branch Secretariat',
        E'\n\n— NBA Ado-Ekiti Branch Secretariat\n0803 000 0003 | secretariat@nba-adoekiti.org',
        '+2348030000003',
        'secretariat@nba-adoekiti.org'
    );

INSERT INTO members
    (branch_id, first_name, last_name, email, phone_number, financial_status, committee_role, amount_due)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'Tunde',    'Bakare',    'tunde.bakare@example.com',    '+2348011111101', 'financial',     'executive',      0),
    ('11111111-1111-1111-1111-111111111111', 'Ngozi',    'Eze',       'ngozi.eze@example.com',       '+2348011111102', 'financial',     'branch_officer', 0),
    ('11111111-1111-1111-1111-111111111111', 'Bola',     'Adeyemi',   'bola.adeyemi@example.com',    '+2348011111103', 'financial',     'none',           0),
    ('11111111-1111-1111-1111-111111111111', 'Chidinma', 'Okoro',     'chidinma.okoro@example.com',  '+2348011111104', 'non_financial', 'none',           25000),
    ('11111111-1111-1111-1111-111111111111', 'Ibrahim',  'Musa',      'ibrahim.musa@example.com',    '+2348011111105', 'non_financial', 'executive',      15000),
    ('11111111-1111-1111-1111-111111111111', 'Folake',   'Ogundipe',  'folake.ogundipe@example.com', '+2348011111106', 'unknown',       'none',           NULL),
    ('11111111-1111-1111-1111-111111111111', 'Emeka',    'Nwachukwu', NULL,                            '+2348011111107', 'financial',     'none',           0),
    ('11111111-1111-1111-1111-111111111111', 'Aisha',    'Bello',     'aisha.bello@example.com',     '+2348011111108', 'non_financial', 'branch_officer', 10000),
    ('11111111-1111-1111-1111-111111111111', 'Segun',    'Afolabi',   'segun.afolabi@example.com',   '+2348011111109', 'financial',     'none',           0),
    ('11111111-1111-1111-1111-111111111111', 'Grace',    'Udo',       'grace.udo@example.com',       '+2348011111110', 'unknown',       'none',           5000);

RESET app.current_branch_id;
