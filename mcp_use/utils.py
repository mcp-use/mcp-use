def singleton(cls):
    """A decorator that implements the singleton pattern for a class.

    This decorator ensures that only one instance of a class is ever created.
    Subsequent attempts to create a new instance will return the existing one.

    Usage:
        @singleton
        class MySingletonClass:
            def __init__(self):
                # ... initialization ...
                pass

    Args:
        cls: The class to be decorated.

    Returns:
        A wrapper function that handles instance creation.
    """
    instance = [None]

    def wrapper(*args, **kwargs):
        if instance[0] is None:
            instance[0] = cls(*args, **kwargs)
        return instance[0]

    return wrapper
