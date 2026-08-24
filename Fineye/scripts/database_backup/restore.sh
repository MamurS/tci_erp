#!/bin/bash


container=$1
db_user=$2
db_name=$3
dump_file=$4
auto_mode=$5
mode_dir="handdump"

if [[ -z $container || -z $db_user || -z $db_name || -z $dump_file ]]; then
    echo "[ERROR] Not valid args."
    exit 1
fi

if [[ ! -f $dump_file ]]; then
    echo "[ERROR] Not exist dump file."
    exit 1
fi

if [[ $auto_mode ]]; then
    . ./.secrets.sh $1 $2
fi

docker cp $dump_file $container:/database.dump

cmd="pg_restore -U $db_user -d $db_name database.dump"

echo "NAME FILE: $dump_file"
echo "PG_RESTORE COMMAND: $cmd"
echo "FULL COMMAND: docker exec -i $container /bin/bash -c \"$cmd\""

if [[ $auto_mode ]]; then
    docker exec -i $container /bin/bash -c "PGPASSWORD=$PGPASSWORD $cmd"
else
    docker exec -i $container /bin/bash -c "$cmd"
fi

docker exec -i $container /bin/bash -c "rm /database.dump"

echo "END."
