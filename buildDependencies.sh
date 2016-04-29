#!/bin/bash

if [ "$1" == "clean" ] ; then
	find . -type d -name node_modules -exec rm -rf {} \; &> /dev/null
fi

function doNpmInstallsForEachSubfolder {
	for serviceDir in $(find $(pwd) -maxdepth 1 -mindepth 1 -type d) ; do
		echo "doing npm installs for inside: $serviceDir"
		(cd $serviceDir && npm install)
		if [ -d "$serviceDir/components" ]; then
			(cd $serviceDir/components && doNpmInstallsForEachSubfolder)
		fi
	done
}

if [ "$1" != "clean" ] ; then
	(cd ./services && doNpmInstallsForEachSubfolder)
fi
