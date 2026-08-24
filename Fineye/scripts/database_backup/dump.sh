#!/bin/bash

container=$1
db_user=$2
db_name=$3
auto_mode=$4
mode_dir="handdump"

if [[ -z $container || -z $db_user || -z $db_name ]]; then
    echo "[ERROR] Input args is invalid"
    exit 1
fi

if [[ $auto_mode ]]; then
    . ./.secrets.sh $1 $2
    mode_dir="autodump"
fi

backup_dir=`realpath .`
backup_dir="$backup_dir/dumps/$container/$db_name/$mode_dir"
mkdir -p $backup_dir

name_file="${db_name}_`date +'%Y%m%d_%H%M'`.dump"
output_file="${backup_dir}/${name_file}"

cmd="pg_dump -Fc -U $db_user -d $db_name"

echo "NAME FILE: $name_file"
echo "OUTPUT DIR: $backup_dir"
echo "OUTPUT PATH: $output_file"
echo "PG_DUMP COMMAND: $cmd"
echo "FULL COMMAND: docker exec -i $container /bin/bash -c \"$cmd\" > $output_file"

status=0
if [[ $auto_mode ]]; then
    docker exec -i $container /bin/bash -c "PGPASSWORD=$PGPASSWORD $cmd" > $output_file
    status="$?"
    [ "$status" != 0 ] && rm -v $output_file
else
    docker exec -i $container /bin/bash -c "$cmd" > $output_file
    status="$?"
    [ "$status" != 0 ] && rm -v $output_file
fi

echo "END."

exit $status
