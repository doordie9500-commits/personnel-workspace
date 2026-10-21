"""Validation of non-operational administrative boards and general classes."""
CATEGORIES=('Військовослужбовець','Новобранець','Стажер')
EXTRA_TABLES=('admin_tasks','admin_log','classes','grades')


def validate_extensions(raw,person_ids,text,day):
    result={}
    for table in EXTRA_TABLES:
        rows=raw.get(table,[])
        if not isinstance(rows,list) or len(rows)>3000:raise ValueError('Некоректна таблиця '+table)
        result[table]=[];ids=set()
        for row in rows:
            key=text(row.get('id'),200,True)
            if key in ids:raise ValueError('Повторення запису.')
            ids.add(key)
            if table=='admin_tasks':
                status=row.get('status','Заплановано')
                if status not in ('Заплановано','В роботі','Виконано'):raise ValueError('Невідомий стан справи.')
                value=dict(id=key,title=text(row.get('title'),200,True),notes=text(row.get('notes',''),4000),owner=text(row.get('owner',''),200),due=day(row.get('due',''),True),status=status)
            elif table=='admin_log':value=dict(id=key,day=day(row.get('day')),category=text(row.get('category','Облік'),100,True),title=text(row.get('title'),200,True),notes=text(row.get('notes',''),4000))
            elif table=='classes':value=dict(id=key,day=day(row.get('day')),title=text(row.get('title'),200,True),teacher=text(row.get('teacher',''),200),notes=text(row.get('notes',''),4000))
            else:
                if row.get('person_id') not in person_ids:raise ValueError('Людину для оцінки не знайдено.')
                score=float(row.get('score',-1))
                if not 0<=score<=100:raise ValueError('Оцінка має бути від 0 до 100.')
                value=dict(id=key,class_id=text(row.get('class_id'),200,True),person_id=row['person_id'],score=score,notes=text(row.get('notes',''),1000))
            result[table].append(value)
    classes={row['id'] for row in result['classes']};graded=set()
    for grade in result['grades']:
        pair=grade['class_id'],grade['person_id']
        if pair in graded or grade['class_id'] not in classes:raise ValueError('Повторення оцінки або невідоме заняття.')
        graded.add(pair)
    return result
