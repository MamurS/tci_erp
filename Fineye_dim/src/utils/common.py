def split_list_into_chunks(list_, chunk_size=5):
    """Разбивает список на чанки указанного размера."""
    
    for i in range(0, len(list_), chunk_size):
        yield list_[i:i + chunk_size]
