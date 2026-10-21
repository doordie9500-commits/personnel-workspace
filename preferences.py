DEFAULTS=dict(display_name='',theme='system',date_format='uk',time_format='24',density='normal',notifications=True,language='uk')

def validate_preferences(raw):
    if not isinstance(raw,dict):raise ValueError('Некоректні налаштування.')
    p={**DEFAULTS,**raw}
    if not isinstance(p['display_name'],str) or len(p['display_name'])>100:raise ValueError('Ім’я має містити до 100 символів.')
    for key,allowed in dict(theme=['system','light','dark'],date_format=['uk','iso'],time_format=['24','12'],density=['normal','compact'],language=['uk']).items():
        if p[key] not in allowed:raise ValueError('Некоректний параметр: '+key)
    if not isinstance(p['notifications'],bool):raise ValueError('Некоректні сповіщення.')
    p['display_name']=p['display_name'].strip()
    return {key:p[key] for key in DEFAULTS}
